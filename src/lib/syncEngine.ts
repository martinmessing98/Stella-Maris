import { auth, getAccessToken } from './firebaseAuth';
import {
  deleteCloudEntity,
  syncCounterMeta,
  upsertCloudEntity,
  type CloudCollectionName,
} from './firestoreSync';
import {
  createCalendarEvent,
  createGoogleContact,
  ensureJobDriveFolder,
  updateCalendarEvent,
  uploadFileToDrive,
} from './googleWorkspace';
import { getOfflineBlob, offlineDb } from './offlineDb';
import type { ClientContact, JobFile, JobOrder, JobScheduleBlock, PaymentRecord, SyncOutboxItem } from '../types';

export interface SyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function processSyncOutbox(): Promise<SyncResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processed: 0, succeeded: 0, failed: 0, errors: ['Device is offline'] };
  }

  const outbox = await offlineDb.getOutbox();
  if (outbox.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, errors: [] };
  }

  const googleToken = getAccessToken();
  const [jobs, schedules, files, contacts, payments] = await Promise.all([
    offlineDb.getJobs(),
    offlineDb.getScheduleBlocks(),
    offlineDb.getFiles(),
    offlineDb.getContacts(),
    offlineDb.getPayments(),
  ]);

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of outbox) {
    try {
      await executeOutboxItem(item, googleToken, jobs, schedules, files, contacts, payments);
      await offlineDb.removeOutboxItem(item.id);
      succeeded++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : 'Sync failed';
      errors.push(msg);
      await offlineDb.addOutboxItem({ ...item, lastError: msg });
    }
  }

  return { processed: outbox.length, succeeded, failed, errors };
}

async function executeOutboxItem(
  item: SyncOutboxItem,
  googleToken: string | null,
  jobs: JobOrder[],
  schedules: JobScheduleBlock[],
  files: JobFile[],
  contacts: ClientContact[],
  payments: PaymentRecord[]
) {
  if (item.entityType === 'calendar-create' || item.entityType === 'calendar-update') {
    if (!googleToken) throw new Error('Sign in with Google to sync schedule events');
    const block = schedules.find((s) => s.id === item.entityId);
    if (!block) return;
    const job = jobs.find((j) => j.id === block.jobId);
    const startDateTime = `${block.date}T${block.startTime}:00`;
    const endDateTime = `${block.date}T${block.endTime}:00`;
    const summary = job ? `[${job.jobNumber}] ${block.title}` : block.title;
    const description = `${job ? `Job: ${job.title}\nClient: ${job.clientName}\n` : ''}Crew: ${block.crewAssigned}\n${block.notes}`;

    const uid = auth.currentUser?.emailVerified ? auth.currentUser.uid : null;
    if (block.googleEventId) {
      await updateCalendarEvent(googleToken, block.googleEventId, {
        summary,
        description,
        location: job?.siteAddress,
        startDateTime,
        endDateTime,
      });
      const updated = { ...block, syncState: 'synced' as const };
      await offlineDb.saveScheduleBlock(updated);
      if (uid) await upsertCloudEntity(uid, 'schedules', updated.id, updated);
    } else {
      const created = await createCalendarEvent(googleToken, {
        summary,
        description,
        location: job?.siteAddress,
        startDateTime,
        endDateTime,
      });
      const updated = { ...block, googleEventId: created.id, syncState: 'synced' as const };
      await offlineDb.saveScheduleBlock(updated);
      if (uid) await upsertCloudEntity(uid, 'schedules', updated.id, updated);
    }
    return;
  }

  if (item.entityType === 'drive-upload') {
    if (!googleToken) throw new Error('Sign in with Google to upload offline photos/docs to Drive');
    const fileMeta = files.find((f) => f.id === item.entityId);
    if (!fileMeta) return;
    const blob = await getOfflineBlob(fileMeta.id);
    if (!blob) throw new Error(`Offline file blob missing for ${fileMeta.name}`);
    const uid = auth.currentUser?.emailVerified ? auth.currentUser.uid : null;
    const job = jobs.find((j) => j.id === fileMeta.jobId);
    const folderLabel = job ? `${job.jobNumber} - ${job.title}` : 'Unassigned Job Files';
    const folderId = job?.driveFolderId || (await ensureJobDriveFolder(googleToken, folderLabel));
    if (job && !job.driveFolderId) {
      const updatedJob = { ...job, driveFolderId: folderId };
      await offlineDb.saveJob(updatedJob);
      if (uid) await upsertCloudEntity(uid, 'jobs', updatedJob.id, updatedJob);
    }
    const uploaded = await uploadFileToDrive(googleToken, blob, fileMeta.name, fileMeta.mimeType, folderId);
    const updatedFile: JobFile = {
      ...fileMeta,
      driveFileId: uploaded.id,
      driveWebViewLink: uploaded.webViewLink,
      syncState: 'synced',
    };
    await offlineDb.saveFile(updatedFile);
    if (uid) await upsertCloudEntity(uid, 'files', updatedFile.id, updatedFile);
    return;
  }

  if (item.entityType === 'contact-create') {
    if (!googleToken) throw new Error('Sign in with Google to sync client contacts');
    const contact = contacts.find((c) => c.id === item.entityId);
    if (!contact) return;
    const synced = await createGoogleContact(googleToken, {
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      company: contact.company,
    });
    const updatedContact: ClientContact = {
      ...contact,
      googleResourceName: synced.googleResourceName,
      syncState: 'synced',
    };
    await offlineDb.saveContact(updatedContact);
    const uid = auth.currentUser?.emailVerified ? auth.currentUser.uid : null;
    if (uid) await upsertCloudEntity(uid, 'contacts', updatedContact.id, updatedContact);
    return;
  }

  if (item.entityType === 'quickbooks-invoice') {
    const payment = payments.find((p) => p.id === item.entityId);
    if (!payment) return;
    const res = await fetch('/api/quickbooks/invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'FieldLedger',
      },
      body: JSON.stringify({
        customerName: payment.clientName,
        amount: payment.amount,
        description: `${payment.jobTitle} — ${payment.notes || payment.type}`,
        txnDate: payment.date,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'Connect QuickBooks Online to sync queued invoice');
    }
    const data = (await res.json()) as { invoice?: { Id: string; DocNumber?: string } };
    const updatedPayment: PaymentRecord = {
      ...payment,
      quickbooksId: data.invoice?.Id,
      referenceNumber: data.invoice?.DocNumber ? `QB-${data.invoice.DocNumber}` : payment.referenceNumber,
      syncState: 'synced',
    };
    await offlineDb.savePayment(updatedPayment);
    const uid = auth.currentUser?.uid;
    if (uid && auth.currentUser?.emailVerified) {
      await upsertCloudEntity(uid, 'payments', updatedPayment.id, updatedPayment);
    }
    return;
  }

  if (item.entityType === 'firestore-upsert') {
    const user = auth.currentUser;
    if (!user || !user.emailVerified) {
      throw new Error('Sign in with Google to sync offline edits to the cloud database');
    }
    const collectionName = item.payload?.collection as CloudCollectionName | 'meta' | undefined;
    if (!collectionName) return;
    if (collectionName === 'meta') {
      const seq = await offlineDb.getNextJobSeq();
      await syncCounterMeta(user.uid, seq);
      return;
    }
    const lookup: Record<CloudCollectionName, unknown> = {
      jobs: jobs.find((j) => j.id === item.entityId),
      schedules: schedules.find((s) => s.id === item.entityId),
      dailyLogs: undefined,
      payments: payments.find((p) => p.id === item.entityId),
      files: files.find((f) => f.id === item.entityId),
      contacts: contacts.find((c) => c.id === item.entityId),
    };
    let entity = lookup[collectionName];
    if (collectionName === 'dailyLogs') {
      const logs = await offlineDb.getDailyLogs();
      entity = logs.find((l) => l.id === item.entityId);
    }
    if (!entity) return;
    await upsertCloudEntity(user.uid, collectionName, item.entityId, entity);
    return;
  }

  if (item.entityType === 'firestore-delete') {
    const user = auth.currentUser;
    if (!user || !user.emailVerified) {
      throw new Error('Sign in with Google to sync deletions to the cloud database');
    }
    const collectionName = item.payload?.collection as CloudCollectionName | undefined;
    if (!collectionName) return;
    await deleteCloudEntity(user.uid, collectionName, item.entityId);
  }
}
