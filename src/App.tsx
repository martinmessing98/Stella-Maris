import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BarChart3,
  Briefcase,
  Calendar,
  CreditCard,
  FolderOpen,
  LogOut,
  Menu,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { ConfirmModal } from './components/ConfirmModal';
import { ContactsModal } from './components/ContactsModal';
import { FilesDocsView } from './components/FilesDocsView';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { JobOrderDetail } from './components/JobOrderDetail';
import { JobOrdersView } from './components/JobOrdersView';
import { OfflineSyncBanner } from './components/OfflineSyncBanner';
import { PaymentHistoryView } from './components/PaymentHistoryView';
import { ProfitabilityView } from './components/ProfitabilityView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SchedulingView } from './components/SchedulingView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { clearCachedToken, getAccessToken, googleSignIn, initAuth, logout } from './lib/firebaseAuth';
import {
  deleteCloudEntity,
  initializeOrMigrateUserCloudDb,
  subscribeUserCloudData,
  syncCounterMeta,
  testFirestoreConnection,
  upsertCloudEntity,
  type CloudCollectionName,
} from './lib/firestoreSync';
import { formatPhoneNumber, generateId } from './lib/formatters';
import {
  createCalendarEvent,
  createGoogleContact,
  deleteCalendarEvent,
  deleteDriveFile,
  ensureJobDriveFolder,
  listCalendarEvents,
  listGoogleContacts,
  listGoogleDrivePhotos,
  uploadFileToDrive,
  WorkspaceAuthError,
} from './lib/googleWorkspace';
import { deleteOfflineBlob, ensureSeededDatabase, offlineDb, saveOfflineBlob } from './lib/offlineDb';
import { processSyncOutbox } from './lib/syncEngine';
import type {
  ClientContact,
  DailyLog,
  GoogleCalendarEvent,
  GooglePhotoItem,
  JobFile,
  JobOrder,
  JobScheduleBlock,
  PaymentRecord,
  QuickBooksStatus,
  WorkspaceTab,
} from './types';

interface PendingConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  action: () => Promise<void>;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'job-orders', label: 'Job Orders', icon: Briefcase },
  { id: 'scheduling', label: 'Scheduling', icon: Calendar },
  { id: 'payments', label: 'Payment History', icon: CreditCard },
  { id: 'files', label: 'Files & Docs', icon: FolderOpen },
  { id: 'profitability', label: 'Profitability', icon: BarChart3 },
];

export default function App() {
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('job-orders');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Core IndexedDB Data
  const [loadingDb, setLoadingDb] = useState(true);
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [schedules, setSchedules] = useState<JobScheduleBlock[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [files, setFiles] = useState<JobFile[]>([]);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  // Auth & Integrations State
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [qbStatus, setQbStatus] = useState<QuickBooksStatus | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<
    'signed-out' | 'connecting' | 'synced' | 'offline' | 'error'
  >('signed-out');

  // Sync & UI Feedback State
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [isSyncingQb, setIsSyncingQb] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null);

  // Modals
  const [contactsModalOpen, setContactsModalOpen] = useState(false);
  const [contactPickerCb, setContactPickerCb] = useState<((c: ClientContact) => void) | null>(null);
  const [preselectedPaymentJobId, setPreselectedPaymentJobId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const showToast = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const reloadLocalData = useCallback(async () => {
    await ensureSeededDatabase();
    const [j, s, l, p, f, c, cal, outbox] = await Promise.all([
      offlineDb.getJobs(),
      offlineDb.getScheduleBlocks(),
      offlineDb.getDailyLogs(),
      offlineDb.getPayments(),
      offlineDb.getFiles(),
      offlineDb.getContacts(),
      offlineDb.getCalendarCache(),
      offlineDb.getOutbox(),
    ]);
    setJobs(j);
    setSchedules(s);
    setDailyLogs(l);
    setPayments(p);
    setFiles(f);
    setContacts(c);
    setGoogleEvents(cal);
    setPendingCount(outbox.length);
  }, []);

  const refreshQbStatus = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const res = await fetch('/api/quickbooks/status');
      if (res.ok) {
        const data = (await res.json()) as QuickBooksStatus;
        setQbStatus(data);
      }
    } catch {
      // Offline or server unreachable
    }
  }, []);

  useEffect(() => {
    testFirestoreConnection();
    reloadLocalData().finally(() => setLoadingDb(false));
    refreshQbStatus();

    const unsub = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setHasGoogleToken(Boolean(token));
      },
      () => {
        setGoogleUser(null);
        setHasGoogleToken(false);
        setCloudSyncStatus('signed-out');
      }
    );
    return () => unsub();
  }, [reloadLocalData, refreshQbStatus]);

  // Listen for QuickBooks OAuth Popup Completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'QUICKBOOKS_OAUTH_SUCCESS') {
        refreshQbStatus();
        showToast('QuickBooks Online connected.');
      } else if (event.data?.type === 'QUICKBOOKS_OAUTH_ERROR') {
        showToast('QuickBooks authorization was cancelled.', 'error');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshQbStatus, showToast]);

  const handleSyncOutbox = useCallback(async () => {
    if (!isOnline) return;
    setIsSyncing(true);
    try {
      const res = await processSyncOutbox();
      await reloadLocalData();
      if (res.succeeded > 0) {
        showToast(`Synced ${res.succeeded} offline item(s).`);
      } else if (res.failed > 0 && res.errors[0]) {
        showToast(res.errors[0], 'error');
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, reloadLocalData, showToast]);

  // Real-time Firestore Cloud Sync tied to signed-in Google account
  useEffect(() => {
    if (!googleUser) {
      setCloudSyncStatus('signed-out');
      return;
    }
    if (!googleUser.emailVerified) {
      setCloudSyncStatus('error');
      showToast('Please verify your Google email to enable cloud sync.', 'error');
      return;
    }
    if (!isOnline) {
      setCloudSyncStatus('offline');
      return;
    }

    let cancelled = false;
    let unsubCloud: (() => void) | null = null;

    setCloudSyncStatus('connecting');

    (async () => {
      try {
        await reloadLocalData();
        const mode = await initializeOrMigrateUserCloudDb(googleUser.uid);
        if (cancelled) return;

        unsubCloud = subscribeUserCloudData(googleUser.uid, {
          onJobs: setJobs,
          onSchedules: setSchedules,
          onDailyLogs: setDailyLogs,
          onPayments: setPayments,
          onFiles: setFiles,
          onContacts: setContacts,
          onNextJobSeq: (seq) => {
            offlineDb.setNextJobSeq(seq);
          },
          onSyncedSnapshot: () => {
            if (!cancelled) setCloudSyncStatus('synced');
          },
          onError: (err) => {
            if (!cancelled) {
              setCloudSyncStatus('error');
              showToast(`Cloud sync error: ${err.message}`, 'error');
            }
          },
        });

        setCloudSyncStatus('synced');
        if (mode === 'migrated') {
          showToast('Saved your job orders & data to the cloud database.');
        }

        const outbox = await offlineDb.getOutbox();
        if (outbox.length > 0 && !cancelled) {
          await handleSyncOutbox();
        }
      } catch (err) {
        if (!cancelled) {
          setCloudSyncStatus('error');
          showToast(err instanceof Error ? err.message : 'Unable to connect cloud database', 'error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsubCloud) unsubCloud();
    };
  }, [googleUser, isOnline, reloadLocalData, handleSyncOutbox, showToast]);

  useEffect(() => {
    if (isOnline && pendingCount > 0 && (hasGoogleToken || googleUser)) {
      handleSyncOutbox();
    }
  }, [isOnline, pendingCount, hasGoogleToken, googleUser, handleSyncOutbox]);

  const persistCloudUpsert = useCallback(
    async (collectionName: CloudCollectionName, entityId: string, entity: unknown) => {
      if (!googleUser || !googleUser.emailVerified) return;
      if (!isOnline) {
        await offlineDb.addOutboxItem({
          id: `fs-up-${collectionName}-${entityId}`,
          entityType: 'firestore-upsert',
          entityId,
          payload: { collection: collectionName },
          createdAt: new Date().toISOString(),
        });
        return;
      }
      try {
        await upsertCloudEntity(googleUser.uid, collectionName, entityId, entity);
      } catch {
        await offlineDb.addOutboxItem({
          id: `fs-up-${collectionName}-${entityId}`,
          entityType: 'firestore-upsert',
          entityId,
          payload: { collection: collectionName },
          createdAt: new Date().toISOString(),
        });
      }
    },
    [googleUser, isOnline]
  );

  const persistCloudDelete = useCallback(
    async (collectionName: CloudCollectionName, entityId: string) => {
      if (!googleUser || !googleUser.emailVerified) return;
      await offlineDb.removeOutboxItem(`fs-up-${collectionName}-${entityId}`);
      if (!isOnline) {
        await offlineDb.addOutboxItem({
          id: `fs-del-${collectionName}-${entityId}`,
          entityType: 'firestore-delete',
          entityId,
          payload: { collection: collectionName },
          createdAt: new Date().toISOString(),
        });
        return;
      }
      try {
        await deleteCloudEntity(googleUser.uid, collectionName, entityId);
      } catch {
        await offlineDb.addOutboxItem({
          id: `fs-del-${collectionName}-${entityId}`,
          entityType: 'firestore-delete',
          entityId,
          payload: { collection: collectionName },
          createdAt: new Date().toISOString(),
        });
      }
    },
    [googleUser, isOnline]
  );

  const persistCounterMeta = useCallback(async () => {
    if (!googleUser || !googleUser.emailVerified) return;
    const seq = await offlineDb.getNextJobSeq();
    if (!isOnline) {
      await offlineDb.addOutboxItem({
        id: 'fs-up-meta-counters',
        entityType: 'firestore-upsert',
        entityId: 'counters',
        payload: { collection: 'meta' },
        createdAt: new Date().toISOString(),
      });
      return;
    }
    try {
      await syncCounterMeta(googleUser.uid, seq);
    } catch {
      await offlineDb.addOutboxItem({
        id: 'fs-up-meta-counters',
        entityType: 'firestore-upsert',
        entityId: 'counters',
        payload: { collection: 'meta' },
        createdAt: new Date().toISOString(),
      });
    }
  }, [googleUser, isOnline]);

  // Google Sign-In & Workspace Sync Helpers
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      setGoogleUser(result.user);
      setHasGoogleToken(true);
      showToast(`Signed in as ${result.user.email || result.user.displayName}`);
      await handleSyncOutbox();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Google sign-in failed', 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setGoogleUser(null);
    setHasGoogleToken(false);
    setCloudSyncStatus('signed-out');
    showToast('Signed out of Google & Cloud Sync.');
  };

  const requireGoogleToken = (): string | null => {
    const token = getAccessToken();
    if (!token) {
      setHasGoogleToken(false);
      showToast('Sign in with Google to sync with Calendar, Contacts, and Drive.', 'error');
      return null;
    }
    return token;
  };

  const handleRefreshGoogleCalendar = async () => {
    const token = requireGoogleToken();
    if (!token) return;
    setIsSyncingCalendar(true);
    try {
      const now = new Date();
      const min = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const max = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();
      const events = await listCalendarEvents(token, min, max);
      await offlineDb.saveCalendarCache(events);
      setGoogleEvents(events);
      showToast(`Loaded ${events.length} events from Google Calendar.`);
    } catch (err) {
      if (err instanceof WorkspaceAuthError) {
        clearCachedToken();
        setHasGoogleToken(false);
      }
      showToast(err instanceof Error ? err.message : 'Calendar sync failed', 'error');
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const handleSyncContactsFromGoogle = async () => {
    const token = requireGoogleToken();
    if (!token) return;
    setIsSyncingContacts(true);
    try {
      const fetched = await listGoogleContacts(token);
      await offlineDb.putManyContacts(fetched);
      await Promise.all(fetched.map((c) => persistCloudUpsert('contacts', c.id, c)));
      await reloadLocalData();
      showToast(`Synced ${fetched.length} client contacts from Google.`);
    } catch (err) {
      if (err instanceof WorkspaceAuthError) {
        clearCachedToken();
        setHasGoogleToken(false);
      }
      showToast(err instanceof Error ? err.message : 'Contacts sync failed', 'error');
    } finally {
      setIsSyncingContacts(false);
    }
  };

  const handleCreateContact = async (
    contactData: Omit<ClientContact, 'id' | 'syncState' | 'googleResourceName'>,
    syncToGoogle: boolean
  ) => {
    const localContact: ClientContact = {
      ...contactData,
      id: generateId('contact'),
      syncState: syncToGoogle ? 'pending' : 'local',
    };

    if (!syncToGoogle) {
      await offlineDb.saveContact(localContact);
      await persistCloudUpsert('contacts', localContact.id, localContact);
      await reloadLocalData();
      showToast(`Saved ${localContact.name}.`);
      return;
    }

    if (!isOnline) {
      await offlineDb.saveContact(localContact);
      await persistCloudUpsert('contacts', localContact.id, localContact);
      await offlineDb.addOutboxItem({
        id: generateId('out'),
        entityType: 'contact-create',
        entityId: localContact.id,
        payload: {},
        createdAt: new Date().toISOString(),
      });
      await reloadLocalData();
      showToast(`${localContact.name} saved offline and queued for Google Contacts.`);
      return;
    }

    setConfirmState({
      title: 'Add Contact to Google Contacts?',
      description: `This will create "${contactData.name}" in your Google Contacts account and save a copy offline.`,
      confirmLabel: 'Create in Google Contacts',
      action: async () => {
        const token = requireGoogleToken();
        if (!token) return;
        const created = await createGoogleContact(token, contactData);
        await offlineDb.saveContact(created);
        await persistCloudUpsert('contacts', created.id, created);
        await reloadLocalData();
        showToast(`Added ${created.name} to Google Contacts.`);
      },
    });
  };

  const handleDeleteContact = (contact: ClientContact) => {
    setConfirmState({
      title: `Delete ${contact.name}?`,
      description: `Remove "${contact.name}" from your Contacts list?`,
      confirmLabel: 'Delete Contact',
      tone: 'danger',
      action: async () => {
        await offlineDb.deleteContact(contact.id);
        await persistCloudDelete('contacts', contact.id);
        await reloadLocalData();
        showToast(`Deleted ${contact.name} from Contacts.`);
      },
    });
  };

  const handleClearAllContacts = () => {
    setConfirmState({
      title: 'Delete All Contacts?',
      description: `Permanently delete all ${contacts.length} contact(s) from your Contacts list and cloud sync?`,
      confirmLabel: 'Delete All Contacts',
      tone: 'danger',
      action: async () => {
        const currentContacts = await offlineDb.getContacts();
        await offlineDb.clearAllContacts();
        await Promise.all(currentContacts.map((c) => persistCloudDelete('contacts', c.id)));
        await reloadLocalData();
        showToast('All contacts deleted.');
      },
    });
  };

  const syncJobClientToContacts = async (job: JobOrder): Promise<JobOrder> => {
    const cleanName = job.clientName.trim();
    if (!cleanName) return job;

    const cleanPhone = formatPhoneNumber(job.clientPhone);
    const cleanEmail = (job.clientEmail || '').trim();
    const cleanAddress =
      job.siteAddress && job.siteAddress.trim() !== 'Client site address'
        ? job.siteAddress.trim()
        : '';

    const existingContacts = await offlineDb.getContacts();
    const matched =
      (job.clientId ? existingContacts.find((c) => c.id === job.clientId) : undefined) ||
      existingContacts.find((c) => c.name.trim().toLowerCase() === cleanName.toLowerCase());

    if (matched) {
      const updatedContact: ClientContact = {
        ...matched,
        name: cleanName,
        phone: cleanPhone || matched.phone,
        email: cleanEmail || matched.email,
        address: cleanAddress || matched.address,
      };
      const changed =
        updatedContact.name !== matched.name ||
        updatedContact.phone !== matched.phone ||
        updatedContact.email !== matched.email ||
        updatedContact.address !== matched.address;
      if (changed) {
        await offlineDb.saveContact(updatedContact);
        await persistCloudUpsert('contacts', updatedContact.id, updatedContact);
      }
      return job.clientId === matched.id ? job : { ...job, clientId: matched.id };
    }

    const newContact: ClientContact = {
      id: job.clientId || generateId('contact'),
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      address: cleanAddress,
      syncState: 'local',
    };
    await offlineDb.saveContact(newContact);
    await persistCloudUpsert('contacts', newContact.id, newContact);
    return { ...job, clientId: newContact.id };
  };

  // Job Order CRUD
  const handleCreateJob = async (
    job: JobOrder,
    attachedPhotos: File[] = [],
    linkedGooglePhotos: GooglePhotoItem[] = []
  ) => {
    const jobWithContact = await syncJobClientToContacts(job);
    await offlineDb.saveJob(jobWithContact);
    await persistCloudUpsert('jobs', jobWithContact.id, jobWithContact);
    await persistCounterMeta();

    for (const photo of linkedGooglePhotos) {
      const record: JobFile = {
        id: generateId('file'),
        jobId: jobWithContact.id,
        name: photo.name,
        category: 'Site Photo',
        mimeType: photo.mimeType || 'image/jpeg',
        sizeBytes: Number(photo.size) || 0,
        uploadedAt: new Date().toISOString(),
        driveFileId: photo.id,
        driveWebViewLink: photo.webViewLink,
        googlePhotosUrl: photo.thumbnailLink,
        syncState: 'synced',
      };
      await offlineDb.saveFile(record);
      await persistCloudUpsert('files', record.id, record);
    }

    if (attachedPhotos.length > 0) {
      await uploadAndSaveJobFiles(jobWithContact.id, 'Site Photo', attachedPhotos, jobWithContact);
    } else {
      await reloadLocalData();
    }
    showToast(`Created job ${jobWithContact.jobNumber} and synced client to Contacts.`);
  };

  const handleUpdateJob = async (updated: JobOrder) => {
    const syncedJob = await syncJobClientToContacts(updated);
    await offlineDb.saveJob(syncedJob);
    await persistCloudUpsert('jobs', syncedJob.id, syncedJob);
    await reloadLocalData();
  };

  const handleDeleteJob = (job: JobOrder) => {
    setConfirmState({
      title: `Delete Job Order ${job.jobNumber}?`,
      description: `Are you sure you want to permanently delete "${job.title}" (${job.clientName})? This will remove the job order along with its schedule blocks, daily logs, and local file cache. Payment history records will be preserved for accounting.`,
      confirmLabel: 'Delete Job Order',
      tone: 'danger',
      action: async () => {
        const jobSchedules = schedules.filter((s) => s.jobId === job.id);
        const jobLogs = dailyLogs.filter((l) => l.jobId === job.id);
        const jobFiles = files.filter((f) => f.jobId === job.id);

        await Promise.all([
          offlineDb.deleteJob(job.id),
          persistCloudDelete('jobs', job.id),
          ...jobSchedules.flatMap((s) => [
            offlineDb.deleteScheduleBlock(s.id),
            persistCloudDelete('schedules', s.id),
          ]),
          ...jobLogs.flatMap((l) => [
            offlineDb.deleteDailyLog(l.id),
            persistCloudDelete('dailyLogs', l.id),
          ]),
          ...jobFiles.flatMap((f) => [
            deleteOfflineBlob(f.id),
            offlineDb.deleteFile(f.id),
            persistCloudDelete('files', f.id),
          ]),
        ]);

        setSelectedJobId(null);
        await reloadLocalData();
        showToast(`Deleted job order ${job.jobNumber}.`);
      },
    });
  };

  // Schedule Block CRUD + Google Calendar Confirmation
  const handleAddScheduleBlock = async (
    blockData: Omit<JobScheduleBlock, 'id' | 'syncState'>,
    syncToGoogle: boolean
  ) => {
    const newBlock: JobScheduleBlock = {
      ...blockData,
      id: generateId('sch'),
      syncState: syncToGoogle ? 'pending' : 'local',
    };

    if (!syncToGoogle) {
      await offlineDb.saveScheduleBlock(newBlock);
      await persistCloudUpsert('schedules', newBlock.id, newBlock);
      await reloadLocalData();
      showToast('Shift scheduled.');
      return;
    }

    if (!isOnline) {
      await offlineDb.saveScheduleBlock(newBlock);
      await persistCloudUpsert('schedules', newBlock.id, newBlock);
      await offlineDb.addOutboxItem({
        id: generateId('out'),
        entityType: 'calendar-create',
        entityId: newBlock.id,
        payload: {},
        createdAt: new Date().toISOString(),
      });
      await reloadLocalData();
      showToast('Shift saved offline and queued for Google Calendar.');
      return;
    }

    const job = jobs.find((j) => j.id === blockData.jobId);
    setConfirmState({
      title: 'Create Event in Google Calendar?',
      description: `Add "${blockData.title}" (${blockData.date} ${blockData.startTime}–${blockData.endTime}) to your primary Google Calendar?`,
      confirmLabel: 'Add to Google Calendar',
      action: async () => {
        const token = requireGoogleToken();
        if (!token) return;
        const created = await createCalendarEvent(token, {
          summary: job ? `[${job.jobNumber}] ${blockData.title}` : blockData.title,
          description: `${job ? `Job: ${job.title}\nClient: ${job.clientName}\n` : ''}Crew: ${blockData.crewAssigned}\n${blockData.notes}`,
          location: job?.siteAddress,
          startDateTime: `${blockData.date}T${blockData.startTime}:00`,
          endDateTime: `${blockData.date}T${blockData.endTime}:00`,
        });
        const syncedBlock: JobScheduleBlock = {
          ...newBlock,
          googleEventId: created.id,
          syncState: 'synced',
        };
        await offlineDb.saveScheduleBlock(syncedBlock);
        await persistCloudUpsert('schedules', syncedBlock.id, syncedBlock);
        await reloadLocalData();
        showToast('Shift added to Google Calendar.');
      },
    });
  };

  const handleSyncScheduleBlock = async (block: JobScheduleBlock) => {
    if (!isOnline) {
      const pendingBlock = { ...block, syncState: 'pending' as const };
      await offlineDb.saveScheduleBlock(pendingBlock);
      await persistCloudUpsert('schedules', pendingBlock.id, pendingBlock);
      await offlineDb.addOutboxItem({
        id: generateId('out'),
        entityType: 'calendar-create',
        entityId: block.id,
        payload: {},
        createdAt: new Date().toISOString(),
      });
      await reloadLocalData();
      showToast('Queued shift for Google Calendar when online.');
      return;
    }

    const job = jobs.find((j) => j.id === block.jobId);
    setConfirmState({
      title: 'Sync Shift to Google Calendar?',
      description: `Push "${block.title}" on ${block.date} to your primary Google Calendar?`,
      confirmLabel: 'Sync to Calendar',
      action: async () => {
        const token = requireGoogleToken();
        if (!token) return;
        const created = await createCalendarEvent(token, {
          summary: job ? `[${job.jobNumber}] ${block.title}` : block.title,
          description: `${job ? `Job: ${job.title}\nClient: ${job.clientName}\n` : ''}Crew: ${block.crewAssigned}\n${block.notes}`,
          location: job?.siteAddress,
          startDateTime: `${block.date}T${block.startTime}:00`,
          endDateTime: `${block.date}T${block.endTime}:00`,
        });
        const syncedBlock: JobScheduleBlock = {
          ...block,
          googleEventId: created.id,
          syncState: 'synced',
        };
        await offlineDb.saveScheduleBlock(syncedBlock);
        await persistCloudUpsert('schedules', syncedBlock.id, syncedBlock);
        await reloadLocalData();
        showToast('Synced shift to Google Calendar.');
      },
    });
  };

  const handleDeleteScheduleBlock = async (block: JobScheduleBlock) => {
    setConfirmState({
      title: block.googleEventId ? 'Delete Event from Google Calendar?' : 'Remove Scheduled Shift?',
      description: block.googleEventId
        ? `Delete "${block.title}" from FieldLedger and remove the linked event from your Google Calendar?`
        : `Remove "${block.title}" from this job schedule?`,
      confirmLabel: 'Delete Shift',
      tone: 'danger',
      action: async () => {
        if (block.googleEventId && isOnline && hasGoogleToken) {
          const token = requireGoogleToken();
          if (token) {
            await deleteCalendarEvent(token, block.googleEventId);
          }
        }
        await offlineDb.deleteScheduleBlock(block.id);
        await persistCloudDelete('schedules', block.id);
        await reloadLocalData();
        showToast('Scheduled shift removed.');
      },
    });
  };

  // Files, Photos & Daily Logs
  const uploadAndSaveJobFiles = async (
    targetJobId: string,
    category: JobFile['category'],
    rawFiles: File[],
    jobOverride?: JobOrder
  ): Promise<string[]> => {
    let job = jobOverride || jobs.find((j) => j.id === targetJobId);
    if (!job) {
      const allJobs = await offlineDb.getJobs();
      job = allJobs.find((j) => j.id === targetJobId);
    }
    const createdIds: string[] = [];
    const token = getAccessToken();

    for (const file of rawFiles) {
      const fileId = generateId('file');
      createdIds.push(fileId);
      await saveOfflineBlob(fileId, file);

      let syncState: JobFile['syncState'] = 'local';
      let driveFileId: string | undefined;
      let driveWebViewLink: string | undefined;

      if (token && isOnline) {
        try {
          const folderLabel = job ? `${job.jobNumber} - ${job.title}` : 'Unassigned Job Files';
          const folderId = job?.driveFolderId || (await ensureJobDriveFolder(token, folderLabel));
          if (job && !job.driveFolderId) {
            job = { ...job, driveFolderId: folderId };
            await offlineDb.saveJob(job);
            await persistCloudUpsert('jobs', job.id, job);
          }
          const uploaded = await uploadFileToDrive(token, file, file.name, file.type || 'application/octet-stream', folderId);
          driveFileId = uploaded.id;
          driveWebViewLink = uploaded.webViewLink;
          syncState = 'synced';
        } catch {
          syncState = 'pending';
          await offlineDb.addOutboxItem({
            id: generateId('out'),
            entityType: 'drive-upload',
            entityId: fileId,
            payload: {},
            createdAt: new Date().toISOString(),
          });
        }
      } else if (hasGoogleToken || !isOnline) {
        syncState = 'pending';
        await offlineDb.addOutboxItem({
          id: generateId('out'),
          entityType: 'drive-upload',
          entityId: fileId,
          payload: {},
          createdAt: new Date().toISOString(),
        });
      }

      const meta: JobFile = {
        id: fileId,
        jobId: targetJobId,
        name: file.name,
        category,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        hasOfflineBlob: true,
        driveFileId,
        driveWebViewLink,
        syncState,
      };
      await offlineDb.saveFile(meta);
      await persistCloudUpsert('files', meta.id, meta);
    }

    await reloadLocalData();
    return createdIds;
  };

  const handleAddDailyLog = async (logData: Omit<DailyLog, 'id' | 'createdAt'>, attachedFiles: File[]) => {
    const photoIds =
      attachedFiles.length > 0
        ? await uploadAndSaveJobFiles(logData.jobId, 'Site Photo', attachedFiles)
        : [];
    const newLog: DailyLog = {
      ...logData,
      id: generateId('log'),
      photoIds,
      createdAt: new Date().toISOString(),
    };
    await offlineDb.saveDailyLog(newLog);
    await persistCloudUpsert('dailyLogs', newLog.id, newLog);
    await reloadLocalData();
    showToast('Daily field log saved.');
  };

  const handleDeleteFile = async (file: JobFile) => {
    setConfirmState({
      title: file.driveFileId ? 'Delete File from Google Drive?' : 'Delete File?',
      description: file.driveFileId
        ? `Permanently delete "${file.name}" from your Google Drive folder and local device cache?`
        : `Remove "${file.name}" from local offline storage?`,
      confirmLabel: 'Delete File',
      tone: 'danger',
      action: async () => {
        if (file.driveFileId && isOnline && hasGoogleToken) {
          const token = requireGoogleToken();
          if (token) {
            await deleteDriveFile(token, file.driveFileId);
          }
        }
        await deleteOfflineBlob(file.id);
        await offlineDb.deleteFile(file.id);
        await persistCloudDelete('files', file.id);
        await reloadLocalData();
        showToast('File deleted.');
      },
    });
  };

  const handleBrowseGooglePhotos = async () => {
    const token = requireGoogleToken();
    if (!token) throw new Error('Sign in with Google first.');
    return listGoogleDrivePhotos(token);
  };

  const handleLinkGooglePhoto = async (
    targetJobId: string,
    photo: { id: string; name: string; mimeType: string; size?: string; thumbnailLink?: string; webViewLink?: string }
  ) => {
    const record: JobFile = {
      id: generateId('file'),
      jobId: targetJobId,
      name: photo.name,
      category: 'Site Photo',
      mimeType: photo.mimeType || 'image/jpeg',
      sizeBytes: Number(photo.size) || 0,
      uploadedAt: new Date().toISOString(),
      driveFileId: photo.id,
      driveWebViewLink: photo.webViewLink,
      googlePhotosUrl: photo.thumbnailLink,
      syncState: 'synced',
    };
    await offlineDb.saveFile(record);
    await persistCloudUpsert('files', record.id, record);
    await reloadLocalData();
    showToast(`Linked ${photo.name} to job.`);
  };

  // QuickBooks Online Handlers
  const handleConnectQuickBooks = async () => {
    try {
      const res = await fetch('/api/quickbooks/auth/url');
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(err.error || 'QuickBooks OAuth URL unavailable.', 'error');
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.open(url, 'quickbooks_oauth', 'width=620,height=740');
    } catch {
      showToast('Failed to initiate QuickBooks connection.', 'error');
    }
  };

  const handleDisconnectQuickBooks = async () => {
    setConfirmState({
      title: 'Disconnect QuickBooks Online?',
      description: 'Disconnect your QuickBooks Online session from FieldLedger? Existing local payment records will remain.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
      action: async () => {
        await fetch('/api/quickbooks/disconnect', {
          method: 'POST',
          headers: { 'X-Requested-With': 'FieldLedger' },
        });
        await refreshQbStatus();
        showToast('QuickBooks Online disconnected.');
      },
    });
  };

  const handleSyncQuickBooks = async () => {
    setIsSyncingQb(true);
    try {
      const res = await fetch('/api/quickbooks/sync');
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'QuickBooks sync failed');
      }
      const data = (await res.json()) as {
        invoices: Array<{
          Id: string;
          DocNumber?: string;
          TxnDate?: string;
          TotalAmt?: number;
          Balance?: number;
          CustomerRef?: { name?: string };
          PrivateNote?: string;
        }>;
        payments: Array<{
          Id: string;
          TxnDate?: string;
          TotalAmt?: number;
          CustomerRef?: { name?: string };
          PaymentMethodRef?: { name?: string };
          PaymentRefNum?: string;
        }>;
      };

      const mapped: PaymentRecord[] = [
        ...data.payments.map((p) => ({
          id: `qb-pay-${p.Id}`,
          jobId: '',
          jobTitle: 'QuickBooks Synced Payment',
          clientName: p.CustomerRef?.name || 'QuickBooks Customer',
          type: 'Invoice Payment' as const,
          direction: 'inflow' as const,
          amount: Number(p.TotalAmt || 0),
          date: p.TxnDate || new Date().toISOString().slice(0, 10),
          method: 'QuickBooks Online' as const,
          status: 'Paid' as const,
          referenceNumber: p.PaymentRefNum || `QB-PMT-${p.Id}`,
          notes: 'Synced from QuickBooks Online',
          quickbooksId: p.Id,
          syncState: 'synced' as const,
        })),
        ...data.invoices
          .filter((inv) => Number(inv.Balance || 0) > 0)
          .map((inv) => ({
            id: `qb-inv-${inv.Id}`,
            jobId: '',
            jobTitle: 'QuickBooks Open Invoice',
            clientName: inv.CustomerRef?.name || 'QuickBooks Customer',
            type: 'Progress Draw' as const,
            direction: 'inflow' as const,
            amount: Number(inv.Balance || inv.TotalAmt || 0),
            date: inv.TxnDate || new Date().toISOString().slice(0, 10),
            method: 'QuickBooks Online' as const,
            status: 'Pending' as const,
            referenceNumber: inv.DocNumber ? `QB-${inv.DocNumber}` : `QB-INV-${inv.Id}`,
            notes: inv.PrivateNote || 'Open invoice balance in QuickBooks',
            quickbooksId: inv.Id,
            syncState: 'synced' as const,
          })),
      ];

      if (mapped.length > 0) {
        await offlineDb.putManyPayments(mapped);
        await Promise.all(mapped.map((p) => persistCloudUpsert('payments', p.id, p)));
        await reloadLocalData();
      }
      showToast(`Synced ${mapped.length} QuickBooks transaction(s).`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'QuickBooks sync failed', 'error');
    } finally {
      setIsSyncingQb(false);
    }
  };

  const handleRecordPayment = async (record: PaymentRecord, pushToQb: boolean) => {
    if (!pushToQb) {
      await offlineDb.savePayment(record);
      await persistCloudUpsert('payments', record.id, record);
      await reloadLocalData();
      showToast('Payment saved to ledger.');
      return;
    }

    if (!isOnline || !qbStatus?.connected) {
      const pendingPayment: PaymentRecord = { ...record, syncState: 'pending' };
      await offlineDb.savePayment(pendingPayment);
      await persistCloudUpsert('payments', pendingPayment.id, pendingPayment);
      await offlineDb.addOutboxItem({
        id: generateId('out'),
        entityType: 'quickbooks-invoice',
        entityId: record.id,
        payload: {},
        createdAt: new Date().toISOString(),
      });
      await reloadLocalData();
      showToast('Saved locally and queued for QuickBooks Online sync.');
      return;
    }

    setConfirmState({
      title: 'Create Invoice in QuickBooks Online?',
      description: `Push a $${record.amount.toFixed(2)} invoice for "${record.clientName}" (${record.jobTitle}) to QuickBooks Online?`,
      confirmLabel: 'Push to QuickBooks',
      action: async () => {
        const res = await fetch('/api/quickbooks/invoices', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'FieldLedger',
          },
          body: JSON.stringify({
            customerName: record.clientName,
            amount: record.amount,
            description: `${record.jobTitle} — ${record.notes || record.type}`,
            txnDate: record.date,
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Failed to push invoice to QuickBooks.');
        }
        const data = (await res.json()) as { invoice?: { Id: string; DocNumber?: string } };
        const syncedPayment: PaymentRecord = {
          ...record,
          quickbooksId: data.invoice?.Id,
          referenceNumber: data.invoice?.DocNumber ? `QB-${data.invoice.DocNumber}` : record.referenceNumber,
          syncState: 'synced',
        };
        await offlineDb.savePayment(syncedPayment);
        await persistCloudUpsert('payments', syncedPayment.id, syncedPayment);
        await reloadLocalData();
        showToast('Invoice pushed to QuickBooks Online.');
      },
    });
  };

  const activeJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) || null : null;

  const currentSectionLabel = activeJob
    ? `Job Orders / ${activeJob.jobNumber}`
    : NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Job Orders';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-900 text-slate-100 border-r border-slate-800">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
          <img
            src="/src/assets/images/app_icon_fieldledger_1795201225009.jpg"
            alt="FieldLedger mark"
            className="h-9 w-9 rounded-lg object-cover border border-slate-700 shrink-0"
          />
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            FieldLedger
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id !== 'job-orders') setSelectedJobId(null);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setContactPickerCb(null);
                setContactsModalOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap"
            >
              <Users className="h-4 w-4 shrink-0" />
              <span>Contacts</span>
            </button>
          </div>
        </nav>

        <div className="border-t border-slate-800 p-4 space-y-3">
          <div className="space-y-1.5 text-xs text-slate-400">
            <div className="flex items-center justify-between">
              <span>Connectivity</span>
              <span className={isOnline ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                {isOnline ? 'Online' : 'Offline Mode'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Cloud Sync</span>
              <span
                className={
                  cloudSyncStatus === 'synced'
                    ? 'text-emerald-400 font-medium'
                    : cloudSyncStatus === 'connecting' || cloudSyncStatus === 'offline'
                    ? 'text-amber-400 font-medium'
                    : cloudSyncStatus === 'error'
                    ? 'text-red-400 font-medium'
                    : 'text-slate-400'
                }
              >
                {cloudSyncStatus === 'synced'
                  ? 'Synced'
                  : cloudSyncStatus === 'connecting'
                  ? 'Syncing...'
                  : cloudSyncStatus === 'offline'
                  ? 'Queued offline'
                  : cloudSyncStatus === 'error'
                  ? 'Sync error'
                  : 'Sign in needed'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Google Sync</span>
              <span className={hasGoogleToken ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                {hasGoogleToken ? 'Active' : googleUser ? 'Reconnect needed' : 'Sign in needed'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>QuickBooks</span>
              <span className={qbStatus?.connected ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                {qbStatus?.connected ? 'Connected' : 'Not linked'}
              </span>
            </div>
          </div>

          {pendingCount > 0 && isOnline && (
            <button
              type="button"
              onClick={handleSyncOutbox}
              disabled={isSyncing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync {pendingCount} Queued
            </button>
          )}

          <PWAInstallButton />
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="font-display text-sm font-semibold text-slate-900 truncate">
              {currentSectionLabel}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setContactPickerCb(null);
                setContactsModalOpen(true);
              }}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              <Users className="h-3.5 w-3.5 text-slate-500" />
              Contacts
            </button>

            {googleUser ? (
              <div className="flex items-center gap-2">
                <span className="hidden md:inline text-xs font-medium text-slate-700 truncate max-w-[180px]">
                  {googleUser.email || googleUser.displayName}
                </span>
                {!hasGoogleToken && (
                  <GoogleSignInButton
                    onClick={handleGoogleLogin}
                    loading={isLoggingIn}
                    label="Reconnect Photos & Drive"
                  />
                )}
                <button
                  type="button"
                  onClick={handleGoogleLogout}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
                >
                  <LogOut className="h-3.5 w-3.5 text-slate-500" />
                  Sign out
                </button>
              </div>
            ) : (
              <GoogleSignInButton
                onClick={handleGoogleLogin}
                loading={isLoggingIn}
                label="Sign in with Google"
              />
            )}
          </div>
        </header>

        <OfflineSyncBanner
          isOnline={isOnline}
          pendingCount={pendingCount}
          isSyncing={isSyncing}
          onSyncNow={handleSyncOutbox}
        />

        {/* Workspace Viewport */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-[1320px] w-full mx-auto">
          {loadingDb ? (
            <div className="space-y-4">
              <div className="h-8 w-56 rounded bg-slate-200 animate-pulse" />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="h-44 rounded-xl border border-slate-200 bg-white animate-pulse" />
                <div className="h-44 rounded-xl border border-slate-200 bg-white animate-pulse" />
              </div>
            </div>
          ) : activeTab === 'job-orders' && activeJob ? (
            <JobOrderDetail
              job={activeJob}
              schedules={schedules}
              dailyLogs={dailyLogs}
              payments={payments}
              files={files.filter((f) => f.jobId === activeJob.id)}
              googleConnected={hasGoogleToken}
              isOnline={isOnline}
              onBack={() => setSelectedJobId(null)}
              onUpdateJob={handleUpdateJob}
              onDeleteJob={handleDeleteJob}
              onAddScheduleBlock={handleAddScheduleBlock}
              onSyncScheduleBlock={handleSyncScheduleBlock}
              onDeleteScheduleBlock={handleDeleteScheduleBlock}
              onAddDailyLog={handleAddDailyLog}
              onOpenContactPicker={(cb) => {
                setContactPickerCb(() => cb);
                setContactsModalOpen(true);
              }}
              onQuickRecordPayment={(job) => {
                setPreselectedPaymentJobId(job.id);
                setActiveTab('payments');
              }}
            />
          ) : activeTab === 'job-orders' ? (
            <JobOrdersView
              jobs={jobs}
              files={files}
              googleConnected={hasGoogleToken}
              isOnline={isOnline}
              onOpenJob={(id) => setSelectedJobId(id)}
              onCreateJob={handleCreateJob}
              onUpdateJob={handleUpdateJob}
              onOpenContactPicker={(cb) => {
                setContactPickerCb(() => cb);
                setContactsModalOpen(true);
              }}
              onBrowseGooglePhotos={handleBrowseGooglePhotos}
              onGoogleSignIn={handleGoogleLogin}
            />
          ) : activeTab === 'scheduling' ? (
            <SchedulingView
              jobs={jobs}
              schedules={schedules}
              googleEvents={googleEvents}
              googleConnected={hasGoogleToken}
              isOnline={isOnline}
              isSyncingCalendar={isSyncingCalendar}
              onRefreshGoogleCalendar={handleRefreshGoogleCalendar}
              onOpenJob={(id) => {
                setSelectedJobId(id);
                setActiveTab('job-orders');
              }}
              onAddScheduleBlock={handleAddScheduleBlock}
            />
          ) : activeTab === 'payments' ? (
            <PaymentHistoryView
              jobs={jobs}
              payments={payments}
              qbStatus={qbStatus}
              isOnline={isOnline}
              isSyncingQb={isSyncingQb}
              preselectedJobId={preselectedPaymentJobId}
              onClearPreselectedJob={() => setPreselectedPaymentJobId(null)}
              onConnectQuickBooks={handleConnectQuickBooks}
              onDisconnectQuickBooks={handleDisconnectQuickBooks}
              onSyncQuickBooks={handleSyncQuickBooks}
              onRecordPayment={handleRecordPayment}
            />
          ) : activeTab === 'files' ? (
            <FilesDocsView
              jobs={jobs}
              files={files}
              googleConnected={hasGoogleToken}
              isOnline={isOnline}
              onUploadFiles={async (jobId, category, list) => {
                await uploadAndSaveJobFiles(jobId, category, list);
                showToast(`Saved ${list.length} file(s).`);
              }}
              onDeleteFile={handleDeleteFile}
              onBrowseGooglePhotos={handleBrowseGooglePhotos}
              onLinkGooglePhotoToJob={handleLinkGooglePhoto}
            />
          ) : (
            <ProfitabilityView
              jobs={jobs}
              payments={payments}
              onOpenJob={(id) => {
                setSelectedJobId(id);
                setActiveTab('job-orders');
              }}
            />
          )}
        </main>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative flex w-72 max-w-[82vw] flex-col bg-slate-900 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <span className="font-display text-lg font-bold text-white">FieldLedger</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      if (item.id !== 'job-orders') setSelectedJobId(null);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-sm font-medium ${
                      active ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setContactPickerCb(null);
                  setContactsModalOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                <Users className="h-4 w-4" />
                <span>Contacts</span>
              </button>
            </nav>
            <div className="border-t border-slate-800 p-4">
              <PWAInstallButton />
            </div>
          </div>
        </div>
      )}

      {/* Contacts Directory / Picker Modal */}
      <ContactsModal
        open={contactsModalOpen}
        contacts={contacts}
        googleConnected={hasGoogleToken}
        isOnline={isOnline}
        isSyncing={isSyncingContacts}
        onClose={() => {
          setContactsModalOpen(false);
          setContactPickerCb(null);
        }}
        onSyncFromGoogle={handleSyncContactsFromGoogle}
        onCreateContact={handleCreateContact}
        onDeleteContact={handleDeleteContact}
        onClearAllContacts={handleClearAllContacts}
        onSelectContact={contactPickerCb || undefined}
      />

      {/* Explicit Confirmation Dialog for Mutating / Destructive External API Actions */}
      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        confirmLabel={confirmState?.confirmLabel || 'Confirm'}
        tone={confirmState?.tone || 'primary'}
        busy={confirmBusy}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return;
          setConfirmBusy(true);
          try {
            await confirmState.action();
            setConfirmState(null);
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Action failed', 'error');
            setConfirmState(null);
          } finally {
            setConfirmBusy(false);
          }
        }}
      />

      {/* Feedback Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg ${
            toast.tone === 'error'
              ? 'border-red-200 bg-red-600 text-white'
              : 'border-slate-700 bg-slate-900 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
