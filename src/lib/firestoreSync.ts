import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { auth, db } from './firebaseAuth';
import { offlineDb } from './offlineDb';
import type {
  ClientContact,
  DailyLog,
  JobFile,
  JobOrder,
  JobScheduleBlock,
  PaymentRecord,
} from '../types';

export type CloudCollectionName =
  | 'jobs'
  | 'schedules'
  | 'dailyLogs'
  | 'payments'
  | 'files'
  | 'contacts';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

export async function testFirestoreConnection(): Promise<boolean> {
  if (connectionTested) return true;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

function clampString(value: unknown, maxLen: number, fallback = ''): string {
  const s = typeof value === 'string' ? value : fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'item';
}

function toIsoString(val: unknown, fallback?: string): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val.length > 0) {
    return val;
  }
  return fallback || new Date().toISOString();
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeJobForCloud(job: JobOrder, userId: string): Record<string, unknown> {
  const safeId = sanitizeId(job.id);
  const materials = (job.materialsList || []).slice(0, 100).map((m) => ({
    id: sanitizeId(m.id),
    quantity: clampString(m.quantity, 40),
    item: clampString(m.item, 200),
    obtained: Boolean(m.obtained),
  }));
  const lineItems = (job.lineItems || []).slice(0, 100).map((li) => ({
    id: sanitizeId(li.id),
    category: li.category,
    description: clampString(li.description, 240),
    estimatedCost: Number(li.estimatedCost) || 0,
    actualCost: Number(li.actualCost) || 0,
    billableAmount: Number(li.billableAmount) || 0,
  }));

  return stripUndefined({
    id: safeId,
    ownerId: userId,
    jobNumber: clampString(job.jobNumber || '#1', 32, '#1'),
    title: clampString(job.title || 'Untitled Job', 200, 'Untitled Job'),
    trade: job.trade || 'General Handyman',
    status: job.status || 'Open',
    urgency: Math.min(5, Math.max(1, Number(job.urgency) || 2)),
    materialsNeeded: Boolean(job.materialsNeeded || materials.length > 0),
    materialsList: materials,
    clientId: job.clientId ? clampString(job.clientId, 128) : undefined,
    clientName: clampString(job.clientName || 'Client', 160, 'Client'),
    clientPhone: clampString(job.clientPhone || '', 40),
    clientEmail: clampString(job.clientEmail || '', 160),
    siteAddress: clampString(job.siteAddress || '', 300),
    startDate: clampString(job.startDate || new Date().toISOString().slice(0, 10), 20),
    startTime: clampString(job.startTime || '', 20),
    finishDate: clampString(job.finishDate || new Date().toISOString().slice(0, 10), 20),
    finishTime: clampString(job.finishTime || '', 20),
    estimatedRevenue: Number(job.estimatedRevenue) || 0,
    estimatedCost: Number(job.estimatedCost) || 0,
    actualCost: Number(job.actualCost) || 0,
    progressPercent: Math.min(100, Math.max(0, Number(job.progressPercent) || 0)),
    scopeSummary: clampString(job.scopeSummary || '', 5000),
    lineItems,
    coverPhotoUrl: job.coverPhotoUrl ? clampString(job.coverPhotoUrl, 1000) : undefined,
    driveFolderId: job.driveFolderId ? clampString(job.driveFolderId, 256) : undefined,
  });
}

function sanitizeScheduleForCloud(block: JobScheduleBlock, userId: string): Record<string, unknown> {
  return stripUndefined({
    id: sanitizeId(block.id),
    ownerId: userId,
    jobId: sanitizeId(block.jobId),
    title: clampString(block.title || 'Scheduled Shift', 200, 'Scheduled Shift'),
    date: clampString(block.date || new Date().toISOString().slice(0, 10), 20),
    startTime: clampString(block.startTime || '08:00', 20),
    endTime: clampString(block.endTime || '16:00', 20),
    crewAssigned: clampString(block.crewAssigned || 'Crew', 200),
    notes: clampString(block.notes || '', 2000),
    googleEventId: block.googleEventId ? clampString(block.googleEventId, 256) : undefined,
    syncState: block.syncState || 'local',
  });
}

function sanitizeDailyLogForCloud(log: DailyLog, userId: string): Record<string, unknown> {
  return stripUndefined({
    id: sanitizeId(log.id),
    ownerId: userId,
    jobId: sanitizeId(log.jobId),
    date: clampString(log.date || new Date().toISOString().slice(0, 10), 20),
    author: clampString(log.author || 'Field Lead', 120),
    weather: clampString(log.weather || '', 120),
    hoursWorked: Math.max(0, Number(log.hoursWorked) || 0),
    progressPercent: Math.min(100, Math.max(0, Number(log.progressPercent) || 0)),
    workCompleted: clampString(log.workCompleted || '', 3000),
    materialsUsed: clampString(log.materialsUsed || '', 2000),
    notes: clampString(log.notes || '', 3000),
    photoIds: (log.photoIds || []).slice(0, 50).map((id) => clampString(id, 128)),
  });
}

function sanitizePaymentForCloud(payment: PaymentRecord, userId: string): Record<string, unknown> {
  return stripUndefined({
    id: sanitizeId(payment.id),
    ownerId: userId,
    jobId: clampString(payment.jobId || '', 128),
    jobTitle: clampString(payment.jobTitle || 'Job Payment', 200),
    clientName: clampString(payment.clientName || 'Client', 160),
    type: payment.type || 'Invoice Payment',
    direction: payment.direction || 'inflow',
    amount: Number(payment.amount) || 0,
    date: clampString(payment.date || new Date().toISOString().slice(0, 10), 20),
    method: payment.method || 'Check',
    status: payment.status || 'Paid',
    referenceNumber: clampString(payment.referenceNumber || '', 100),
    notes: clampString(payment.notes || '', 2000),
    quickbooksId: payment.quickbooksId ? clampString(payment.quickbooksId, 128) : undefined,
    syncState: payment.syncState || 'local',
  });
}

function sanitizeFileForCloud(file: JobFile, userId: string): Record<string, unknown> {
  // Never store ephemeral blob: URLs or unshared local-only URLs across devices unnecessarily, keep static assets if present
  const safeLocalUrl =
    file.localUrl && !file.localUrl.startsWith('blob:') ? clampString(file.localUrl, 1000) : undefined;
  return stripUndefined({
    id: sanitizeId(file.id),
    ownerId: userId,
    jobId: clampString(file.jobId || '', 128),
    name: clampString(file.name || 'file', 255, 'file'),
    category: file.category || 'Site Photo',
    mimeType: clampString(file.mimeType || 'application/octet-stream', 120),
    sizeBytes: Math.max(0, Number(file.sizeBytes) || 0),
    uploadedAt: clampString(file.uploadedAt || new Date().toISOString(), 40),
    notes: file.notes ? clampString(file.notes, 1000) : undefined,
    localUrl: safeLocalUrl,
    hasOfflineBlob: Boolean(file.hasOfflineBlob),
    driveFileId: file.driveFileId ? clampString(file.driveFileId, 256) : undefined,
    driveWebViewLink: file.driveWebViewLink ? clampString(file.driveWebViewLink, 1000) : undefined,
    googlePhotosUrl: file.googlePhotosUrl ? clampString(file.googlePhotosUrl, 1000) : undefined,
    syncState: file.syncState || 'local',
  });
}

function sanitizeContactForCloud(contact: ClientContact, userId: string): Record<string, unknown> {
  return stripUndefined({
    id: sanitizeId(contact.id),
    ownerId: userId,
    name: clampString(contact.name || 'Client', 160, 'Client'),
    phone: clampString(contact.phone || '', 40),
    email: clampString(contact.email || '', 160),
    address: clampString(contact.address || '', 300),
    company: contact.company ? clampString(contact.company, 160) : undefined,
    googleResourceName: contact.googleResourceName ? clampString(contact.googleResourceName, 256) : undefined,
    syncState: contact.syncState || 'local',
  });
}

function serializeForCollection(
  collectionName: CloudCollectionName,
  entity: unknown,
  userId: string
): Record<string, unknown> {
  switch (collectionName) {
    case 'jobs':
      return sanitizeJobForCloud(entity as JobOrder, userId);
    case 'schedules':
      return sanitizeScheduleForCloud(entity as JobScheduleBlock, userId);
    case 'dailyLogs':
      return sanitizeDailyLogForCloud(entity as DailyLog, userId);
    case 'payments':
      return sanitizePaymentForCloud(entity as PaymentRecord, userId);
    case 'files':
      return sanitizeFileForCloud(entity as JobFile, userId);
    case 'contacts':
      return sanitizeContactForCloud(entity as ClientContact, userId);
  }
}

export async function upsertCloudEntity(
  userId: string,
  collectionName: CloudCollectionName,
  entityId: string,
  entity: unknown
): Promise<void> {
  const safeId = sanitizeId(entityId);
  const path = `users/${userId}/${collectionName}/${safeId}`;
  const ref = doc(db, 'users', userId, collectionName, safeId);
  const payload = serializeForCollection(collectionName, entity, userId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        id: safeId,
        ownerId: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const updatePayload = { ...payload };
      delete updatePayload.id;
      delete updatePayload.ownerId;
      await updateDoc(ref, {
        ...updatePayload,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudEntity(
  userId: string,
  collectionName: CloudCollectionName,
  entityId: string
): Promise<void> {
  const safeId = sanitizeId(entityId);
  const path = `users/${userId}/${collectionName}/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, collectionName, safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncCounterMeta(
  userId: string,
  nextJobSeq: number,
  options?: { contactsResetV1?: boolean }
): Promise<void> {
  const path = `users/${userId}/meta/counters`;
  const ref = doc(db, 'users', userId, 'meta', 'counters');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: userId,
        nextJobSeq: Math.max(1, nextJobSeq),
        seeded: true,
        contactsResetV1: options?.contactsResetV1 ?? true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingSeq = Number(snap.data()?.nextJobSeq) || 1;
      const updateData: Record<string, unknown> = {
        nextJobSeq: Math.max(existingSeq, nextJobSeq),
        seeded: true,
        updatedAt: serverTimestamp(),
      };
      if (options?.contactsResetV1 !== undefined) {
        updateData.contactsResetV1 = options.contactsResetV1;
      }
      await updateDoc(ref, updateData);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function clearAllCloudContacts(
  userId: string,
  skipIds: Set<string> = new Set()
): Promise<void> {
  const contactsPath = `users/${userId}/contacts`;
  try {
    const contactsQ = query(
      collection(db, 'users', userId, 'contacts'),
      where('ownerId', '==', userId)
    );
    const snap = await getDocs(contactsQ);
    await Promise.all(
      snap.docs
        .filter((d) => !skipIds.has(d.id))
        .map((d) => deleteCloudEntity(userId, 'contacts', d.id))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, contactsPath);
  }
}

export async function initializeOrMigrateUserCloudDb(
  userId: string
): Promise<'migrated' | 'existing'> {
  const metaPath = `users/${userId}/meta/counters`;
  const jobsPath = `users/${userId}/jobs`;

  let metaExists = false;
  let contactsResetV1 = false;
  let existingNextSeq = 1;
  try {
    const metaSnap = await getDoc(doc(db, 'users', userId, 'meta', 'counters'));
    metaExists = metaSnap.exists();
    if (metaExists) {
      const data = metaSnap.data();
      contactsResetV1 = Boolean(data?.contactsResetV1);
      existingNextSeq = Number(data?.nextJobSeq) || 1;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, metaPath);
  }

  let hasCloudJobs = false;
  try {
    const jobsQ = query(
      collection(db, 'users', userId, 'jobs'),
      where('ownerId', '==', userId),
      limit(1)
    );
    const jobsSnap = await getDocs(jobsQ);
    hasCloudJobs = !jobsSnap.empty;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, jobsPath);
  }

  if (metaExists || hasCloudJobs) {
    if (!contactsResetV1) {
      const outbox = await offlineDb.getOutbox();
      const pendingUpsertContactIds = new Set(
        outbox
          .filter((o) => o.entityType === 'firestore-upsert' && o.payload?.collection === 'contacts')
          .map((o) => sanitizeId(o.entityId))
      );
      await clearAllCloudContacts(userId, pendingUpsertContactIds);
      const localSeq = await offlineDb.getNextJobSeq();
      await syncCounterMeta(userId, Math.max(existingNextSeq, localSeq), { contactsResetV1: true });
    }
    return 'existing';
  }

  // First time this account connects to Firestore: migrate local offlineDb records to the cloud
  const [jobs, schedules, dailyLogs, payments, files, contacts, nextSeq] = await Promise.all([
    offlineDb.getJobs(),
    offlineDb.getScheduleBlocks(),
    offlineDb.getDailyLogs(),
    offlineDb.getPayments(),
    offlineDb.getFiles(),
    offlineDb.getContacts(),
    offlineDb.getNextJobSeq(),
  ]);

  await Promise.all([
    ...jobs.map((j) => upsertCloudEntity(userId, 'jobs', j.id, j)),
    ...schedules.map((s) => upsertCloudEntity(userId, 'schedules', s.id, s)),
    ...dailyLogs.map((l) => upsertCloudEntity(userId, 'dailyLogs', l.id, l)),
    ...payments.map((p) => upsertCloudEntity(userId, 'payments', p.id, p)),
    ...files.map((f) => upsertCloudEntity(userId, 'files', f.id, f)),
    ...contacts.map((c) => upsertCloudEntity(userId, 'contacts', c.id, c)),
    syncCounterMeta(userId, nextSeq, { contactsResetV1: true }),
  ]);

  return 'migrated';
}

function docToJobOrder(data: DocumentData): JobOrder {
  return {
    id: String(data.id),
    jobNumber: String(data.jobNumber || '#1'),
    title: String(data.title || 'Untitled Job'),
    trade: data.trade || 'General Handyman',
    status: data.status || 'Open',
    urgency: (Math.min(5, Math.max(1, Number(data.urgency) || 2)) as JobOrder['urgency']),
    materialsNeeded: Boolean(data.materialsNeeded),
    materialsList: Array.isArray(data.materialsList) ? data.materialsList : [],
    clientId: data.clientId ? String(data.clientId) : undefined,
    clientName: String(data.clientName || ''),
    clientPhone: String(data.clientPhone || ''),
    clientEmail: String(data.clientEmail || ''),
    siteAddress: String(data.siteAddress || ''),
    startDate: String(data.startDate || ''),
    startTime: String(data.startTime || ''),
    finishDate: String(data.finishDate || ''),
    finishTime: String(data.finishTime || ''),
    estimatedRevenue: Number(data.estimatedRevenue) || 0,
    estimatedCost: Number(data.estimatedCost) || 0,
    actualCost: Number(data.actualCost) || 0,
    progressPercent: Number(data.progressPercent) || 0,
    scopeSummary: String(data.scopeSummary || ''),
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
    coverPhotoUrl: data.coverPhotoUrl ? String(data.coverPhotoUrl) : undefined,
    driveFolderId: data.driveFolderId ? String(data.driveFolderId) : undefined,
    updatedAt: toIsoString(data.updatedAt),
  };
}

function docToScheduleBlock(data: DocumentData): JobScheduleBlock {
  return {
    id: String(data.id),
    jobId: String(data.jobId || ''),
    title: String(data.title || ''),
    date: String(data.date || ''),
    startTime: String(data.startTime || ''),
    endTime: String(data.endTime || ''),
    crewAssigned: String(data.crewAssigned || ''),
    notes: String(data.notes || ''),
    googleEventId: data.googleEventId ? String(data.googleEventId) : undefined,
    syncState: data.syncState || 'local',
  };
}

function docToDailyLog(data: DocumentData): DailyLog {
  return {
    id: String(data.id),
    jobId: String(data.jobId || ''),
    date: String(data.date || ''),
    author: String(data.author || ''),
    weather: String(data.weather || ''),
    hoursWorked: Number(data.hoursWorked) || 0,
    progressPercent: Number(data.progressPercent) || 0,
    workCompleted: String(data.workCompleted || ''),
    materialsUsed: String(data.materialsUsed || ''),
    notes: String(data.notes || ''),
    photoIds: Array.isArray(data.photoIds) ? data.photoIds : [],
    createdAt: toIsoString(data.createdAt),
  };
}

function docToPayment(data: DocumentData): PaymentRecord {
  return {
    id: String(data.id),
    jobId: String(data.jobId || ''),
    jobTitle: String(data.jobTitle || ''),
    clientName: String(data.clientName || ''),
    type: data.type || 'Invoice Payment',
    direction: data.direction || 'inflow',
    amount: Number(data.amount) || 0,
    date: String(data.date || ''),
    method: data.method || 'Check',
    status: data.status || 'Paid',
    referenceNumber: String(data.referenceNumber || ''),
    notes: String(data.notes || ''),
    quickbooksId: data.quickbooksId ? String(data.quickbooksId) : undefined,
    syncState: data.syncState || 'local',
  };
}

function docToJobFile(data: DocumentData): JobFile {
  return {
    id: String(data.id),
    jobId: String(data.jobId || ''),
    name: String(data.name || ''),
    category: data.category || 'Site Photo',
    mimeType: String(data.mimeType || 'application/octet-stream'),
    sizeBytes: Number(data.sizeBytes) || 0,
    uploadedAt: String(data.uploadedAt || ''),
    notes: data.notes ? String(data.notes) : undefined,
    localUrl: data.localUrl ? String(data.localUrl) : undefined,
    hasOfflineBlob: Boolean(data.hasOfflineBlob),
    driveFileId: data.driveFileId ? String(data.driveFileId) : undefined,
    driveWebViewLink: data.driveWebViewLink ? String(data.driveWebViewLink) : undefined,
    googlePhotosUrl: data.googlePhotosUrl ? String(data.googlePhotosUrl) : undefined,
    syncState: data.syncState || 'local',
  };
}

function docToContact(data: DocumentData): ClientContact {
  return {
    id: String(data.id),
    name: String(data.name || ''),
    phone: String(data.phone || ''),
    email: String(data.email || ''),
    address: String(data.address || ''),
    company: data.company ? String(data.company) : undefined,
    googleResourceName: data.googleResourceName ? String(data.googleResourceName) : undefined,
    syncState: data.syncState || 'local',
  };
}

export interface CloudSyncCallbacks {
  onJobs: (jobs: JobOrder[]) => void;
  onSchedules: (schedules: JobScheduleBlock[]) => void;
  onDailyLogs: (logs: DailyLog[]) => void;
  onPayments: (payments: PaymentRecord[]) => void;
  onFiles: (files: JobFile[]) => void;
  onContacts: (contacts: ClientContact[]) => void;
  onNextJobSeq: (seq: number) => void;
  onSyncedSnapshot?: () => void;
  onError?: (err: Error) => void;
}

export function subscribeUserCloudData(
  userId: string,
  callbacks: CloudSyncCallbacks
): () => void {
  const unsubs: Array<() => void> = [];

  const handleErr = (err: unknown, path: string) => {
    try {
      handleFirestoreError(err, OperationType.GET, path);
    } catch (wrapped) {
      callbacks.onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
    }
  };

  const jobsPath = `users/${userId}/jobs`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', userId, 'jobs'), where('ownerId', '==', userId)),
      async (snap) => {
        const items = snap.docs.map((d) => docToJobOrder(d.data()));
        await offlineDb.replaceJobsFromCloud(items);
        const normalized = await offlineDb.getJobs();
        callbacks.onJobs(normalized);
        callbacks.onSyncedSnapshot?.();
      },
      (err) => handleErr(err, jobsPath)
    )
  );

  const schedulesPath = `users/${userId}/schedules`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', userId, 'schedules'), where('ownerId', '==', userId)),
      async (snap) => {
        const items = snap.docs.map((d) => docToScheduleBlock(d.data()));
        await offlineDb.replaceSchedulesFromCloud(items);
        callbacks.onSchedules(await offlineDb.getScheduleBlocks());
        callbacks.onSyncedSnapshot?.();
      },
      (err) => handleErr(err, schedulesPath)
    )
  );

  const logsPath = `users/${userId}/dailyLogs`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', userId, 'dailyLogs'), where('ownerId', '==', userId)),
      async (snap) => {
        const items = snap.docs.map((d) => docToDailyLog(d.data()));
        await offlineDb.replaceDailyLogsFromCloud(items);
        callbacks.onDailyLogs(await offlineDb.getDailyLogs());
        callbacks.onSyncedSnapshot?.();
      },
      (err) => handleErr(err, logsPath)
    )
  );

  const paymentsPath = `users/${userId}/payments`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', userId, 'payments'), where('ownerId', '==', userId)),
      async (snap) => {
        const items = snap.docs.map((d) => docToPayment(d.data()));
        await offlineDb.replacePaymentsFromCloud(items);
        callbacks.onPayments(await offlineDb.getPayments());
        callbacks.onSyncedSnapshot?.();
      },
      (err) => handleErr(err, paymentsPath)
    )
  );

  const filesPath = `users/${userId}/files`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', userId, 'files'), where('ownerId', '==', userId)),
      async (snap) => {
        const items = snap.docs.map((d) => docToJobFile(d.data()));
        await offlineDb.replaceFilesFromCloud(items);
        callbacks.onFiles(await offlineDb.getFiles());
        callbacks.onSyncedSnapshot?.();
      },
      (err) => handleErr(err, filesPath)
    )
  );

  const contactsPath = `users/${userId}/contacts`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', userId, 'contacts'), where('ownerId', '==', userId)),
      async (snap) => {
        const items = snap.docs.map((d) => docToContact(d.data()));
        await offlineDb.replaceContactsFromCloud(items);
        callbacks.onContacts(await offlineDb.getContacts());
        callbacks.onSyncedSnapshot?.();
      },
      (err) => handleErr(err, contactsPath)
    )
  );

  const countersPath = `users/${userId}/meta/counters`;
  unsubs.push(
    onSnapshot(
      doc(db, 'users', userId, 'meta', 'counters'),
      async (snap) => {
        if (snap.exists()) {
          const seq = Number(snap.data()?.nextJobSeq) || 1;
          await offlineDb.setNextJobSeq(seq);
          callbacks.onNextJobSeq(seq);
        }
      },
      (err) => handleErr(err, countersPath)
    )
  );

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
