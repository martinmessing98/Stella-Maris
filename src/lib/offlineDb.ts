import { formatPhoneNumber } from './formatters';
import type {
  ClientContact,
  DailyLog,
  GoogleCalendarEvent,
  JobFile,
  JobOrder,
  JobScheduleBlock,
  PaymentRecord,
  SyncOutboxItem,
} from '../types';

const DB_NAME = 'fieldledger-offline-db';
const DB_VERSION = 1;

const STORES = [
  'jobs',
  'dailyLogs',
  'scheduleBlocks',
  'payments',
  'files',
  'fileBlobs',
  'contacts',
  'calendarCache',
  'outbox',
  'meta',
] as const;

type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'fileBlobs' || name === 'meta' ? 'key' : 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function putItem<T>(storeName: StoreName, item: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putMany<T>(storeName: StoreName, items: T[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteItem(storeName: StoreName, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replaceStore<T>(storeName: StoreName, items: T[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getMeta(key: string): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await putItem('meta', { key, value });
}

// ==================== BINARY BLOB STORAGE FOR OFFLINE PHOTOS & DOCS ====================

export async function saveOfflineBlob(fileId: string, blob: Blob): Promise<void> {
  await putItem('fileBlobs', { key: fileId, blob });
}

export async function getOfflineBlob(fileId: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fileBlobs', 'readonly');
    const req = tx.objectStore('fileBlobs').get(fileId);
    req.onsuccess = () => resolve((req.result?.blob as Blob) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOfflineBlob(fileId: string): Promise<void> {
  await deleteItem('fileBlobs', fileId);
}

// ==================== INITIAL SEED FOR FIRST LAUNCH ====================

const SEED_JOBS: JobOrder[] = [
  {
    id: 'job-101',
    jobNumber: '#1',
    title: 'White Oak Kitchen Cabinetry & Island',
    trade: 'Kitchen & Bath',
    status: 'In Progress',
    urgency: 4,
    materialsNeeded: true,
    materialsList: [
      { id: 'mat-1', quantity: '2', item: 'Tube clear silicone caulk', obtained: false },
      { id: 'mat-2', quantity: '12', item: 'Brushed brass cabinet pulls', obtained: true },
    ],
    clientId: 'contact-1',
    clientName: 'Elena Vance',
    clientPhone: '503-555-0148',
    clientEmail: 'elena.vance@example.com',
    siteAddress: '418 Maplecrest Ave, Portland, OR',
    startDate: '2026-11-18',
    startTime: '08:00',
    finishDate: '2026-11-26',
    finishTime: '16:30',
    estimatedRevenue: 18400,
    estimatedCost: 11250,
    actualCost: 9840,
    progressPercent: 68,
    scopeSummary:
      'Remove existing laminate upper/lower cabinets, scribe and hang custom rift-cut white oak cabinetry, install 240V range receptacle, and level island stone support cleats.',
    coverPhotoUrl: '/src/assets/images/job_kitchen_remodel_1795201225803.jpg',
    lineItems: [
      { id: 'li-1', category: 'Materials', description: 'Rift-cut white oak boxes & soft-close hardware', estimatedCost: 6800, actualCost: 6420, billableAmount: 10200 },
      { id: 'li-2', category: 'Labor', description: 'Lead carpenter + helper installation (48 hrs)', estimatedCost: 3120, actualCost: 2470, billableAmount: 5800 },
      { id: 'li-3', category: 'Subcontractor', description: 'Under-cabinet LED & range rough-in', estimatedCost: 980, actualCost: 950, billableAmount: 1850 },
      { id: 'li-4', category: 'Permits & Fees', description: 'City trade permit & haul-away', estimatedCost: 350, actualCost: 0, billableAmount: 550 },
    ],
    updatedAt: '2026-11-20T09:15:00Z',
  },
  {
    id: 'job-102',
    jobNumber: '#2',
    title: 'Western Red Cedar Backyard Deck',
    trade: 'Carpentry & Deck',
    status: 'Open',
    urgency: 2,
    materialsNeeded: true,
    materialsList: [
      { id: 'mat-3', quantity: '40', item: '5/4x6x12 Clear Western Red Cedar boards', obtained: false },
      { id: 'mat-4', quantity: '4 boxes', item: 'Hidden stainless deck fasteners', obtained: false },
    ],
    clientId: 'contact-2',
    clientName: 'Marcus Halvorsen',
    clientPhone: '503-555-0192',
    clientEmail: 'm.halvorsen@example.com',
    siteAddress: '1904 Hawthorne Ridge Rd, Lake Oswego, OR',
    startDate: '2026-11-21',
    startTime: '07:30',
    finishDate: '2026-11-28',
    finishTime: '17:00',
    estimatedRevenue: 14200,
    estimatedCost: 8600,
    actualCost: 4200,
    progressPercent: 30,
    scopeSummary:
      'Pour 12 sonotube concrete footings, frame pressure-treated ledger & joist grid with Simpson hangers, deck with 5/4x6 clear cedar and concealed stainless fasteners.',
    coverPhotoUrl: '/src/assets/images/job_cedar_deck_1795201226178.jpg',
    lineItems: [
      { id: 'li-5', category: 'Materials', description: 'Kiln-dried cedar decking, PT framing & stainless clips', estimatedCost: 5400, actualCost: 4200, billableAmount: 8400 },
      { id: 'li-6', category: 'Labor', description: 'Framing & decking crew (42 hrs)', estimatedCost: 2700, actualCost: 0, billableAmount: 5100 },
      { id: 'li-7', category: 'Permits & Fees', description: 'Structural deck permit & footing inspection', estimatedCost: 500, actualCost: 0, billableAmount: 700 },
    ],
    updatedAt: '2026-11-19T17:40:00Z',
  },
  {
    id: 'job-103',
    jobNumber: '#3',
    title: '200A Main Service Panel Upgrade',
    trade: 'Electrical',
    status: 'Complete',
    urgency: 1,
    materialsNeeded: false,
    materialsList: [],
    clientId: 'contact-3',
    clientName: 'Priya Deshmukh',
    clientPhone: '971-555-0117',
    clientEmail: 'priya.d@example.com',
    siteAddress: '772 Alder Creek Way, Beaverton, OR',
    startDate: '2026-11-10',
    startTime: '08:00',
    finishDate: '2026-11-13',
    finishTime: '15:00',
    estimatedRevenue: 5400,
    estimatedCost: 2950,
    actualCost: 2810,
    progressPercent: 100,
    scopeSummary:
      'Upgrade legacy 100A fuse box to 200A Square D QO main breaker panel, install dual ground rods, AFCI/GFCI breakers, and whole-home surge protection.',
    coverPhotoUrl: '/src/assets/images/job_electrical_panel_1795201227328.jpg',
    lineItems: [
      { id: 'li-8', category: 'Materials', description: '200A Square D panel, copper SER cable & breakers', estimatedCost: 1650, actualCost: 1590, billableAmount: 2900 },
      { id: 'li-9', category: 'Labor', description: 'Master electrician & apprentice (16 hrs)', estimatedCost: 1120, actualCost: 1040, billableAmount: 2200 },
      { id: 'li-10', category: 'Permits & Fees', description: 'Utility disconnect coordination & city inspection', estimatedCost: 180, actualCost: 180, billableAmount: 300 },
    ],
    updatedAt: '2026-11-14T11:00:00Z',
  },
  {
    id: 'job-104',
    jobNumber: '#4',
    title: 'Drywall Patch, Trim & Entry Door Alignment',
    trade: 'General Handyman',
    status: 'Estimate',
    urgency: 3,
    materialsNeeded: true,
    materialsList: [
      { id: 'mat-5', quantity: '3', item: '4-inch satin nickel ball-bearing hinges', obtained: false },
    ],
    clientId: 'contact-4',
    clientName: 'David Kowalski',
    clientPhone: '503-555-0174',
    clientEmail: 'dkowalski@example.com',
    siteAddress: '2310 Cedar Mill Blvd, Portland, OR',
    startDate: '2026-11-29',
    startTime: '09:00',
    finishDate: '2026-11-30',
    finishTime: '14:00',
    estimatedRevenue: 1950,
    estimatedCost: 780,
    actualCost: 0,
    progressPercent: 0,
    scopeSummary:
      'Re-hang sticking solid-core front entry door with heavy-duty mortise hinges, skim coat hallway drywall patches, prime and paint baseboard trim.',
    lineItems: [
      { id: 'li-11', category: 'Materials', description: 'Ball-bearing hinges, hot mud, primer & semi-gloss', estimatedCost: 260, actualCost: 0, billableAmount: 450 },
      { id: 'li-12', category: 'Labor', description: 'Senior handyman (10 hrs)', estimatedCost: 520, actualCost: 0, billableAmount: 1500 },
    ],
    updatedAt: '2026-11-20T08:05:00Z',
  },
];

const SEED_SCHEDULES: JobScheduleBlock[] = [
  {
    id: 'sch-1',
    jobId: 'job-101',
    title: 'Upper & Island Cabinet Scribe + Hanging',
    date: '2026-11-20',
    startTime: '08:00',
    endTime: '16:00',
    crewAssigned: 'Martin M., Carlos R.',
    notes: 'Verify laser level datum across south wall before anchoring pantry tower.',
    syncState: 'local',
  },
  {
    id: 'sch-2',
    jobId: 'job-102',
    title: 'Joist Hangers & Cedar Deck Board Layout',
    date: '2026-11-21',
    startTime: '07:30',
    endTime: '15:30',
    crewAssigned: 'Martin M., Jake T.',
    notes: 'Lumber delivery arrives 07:45 AM via side driveway.',
    syncState: 'local',
  },
  {
    id: 'sch-3',
    jobId: 'job-101',
    title: 'Countertop Template & Toe-Kick Trim',
    date: '2026-11-24',
    startTime: '09:30',
    endTime: '13:30',
    crewAssigned: 'Martin M.',
    notes: 'Stone fabricator meeting on-site at 10:00 AM.',
    syncState: 'local',
  },
  {
    id: 'sch-4',
    jobId: 'job-104',
    title: 'Site Walk & Entry Door Hinge Mortising',
    date: '2026-11-29',
    startTime: '09:00',
    endTime: '14:00',
    crewAssigned: 'Martin M.',
    notes: 'Bring router jig and 4-inch satin nickel hinges.',
    syncState: 'local',
  },
];

const SEED_LOGS: DailyLog[] = [
  {
    id: 'log-1',
    jobId: 'job-101',
    date: '2026-11-19',
    author: 'Martin Messing',
    weather: 'Dry Indoor · 52°F',
    hoursWorked: 8.5,
    progressPercent: 68,
    workCompleted: 'Hung all 4 upper wall cabinets, shimmed base perimeter level to 1/16", secured island sub-frame.',
    materialsUsed: '18x GRK #10 structural cabinet screws, cedar shims, Ramboard floor protection.',
    notes: 'Client approved brass pull placement on pantry doors. Ready for electrician under-cabinet whip tomorrow.',
    photoIds: ['file-1'],
    createdAt: '2026-11-19T16:45:00Z',
  },
  {
    id: 'log-2',
    jobId: 'job-102',
    date: '2026-11-18',
    author: 'Martin Messing',
    weather: 'Partly Cloudy · 49°F',
    hoursWorked: 7.0,
    progressPercent: 30,
    workCompleted: 'Flashed house ledger with butyl tape and aluminum Z-flashing; framed outer rim joists and 2x10 deck joists.',
    materialsUsed: '18x 2x10x16 PT joists, Simpson LUS210 hangers, 1/2" galvanized ledger lags.',
    notes: 'Footing inspection signed off by city inspector at 11:20 AM.',
    photoIds: ['file-2'],
    createdAt: '2026-11-18T17:10:00Z',
  },
  {
    id: 'log-3',
    jobId: 'job-103',
    date: '2026-11-13',
    author: 'Martin Messing',
    weather: 'Clear · 54°F',
    hoursWorked: 6.5,
    progressPercent: 100,
    workCompleted: 'Terminated all 24 branch circuits cleanly, labeled circuit directory, passed final electrical inspection.',
    materialsUsed: 'Square D QO 200A Load Center, 8x 20A AFCI breakers, #4 bare copper ground.',
    notes: 'Homeowner walked through breaker panel labeling and surge protector indicator.',
    photoIds: ['file-3'],
    createdAt: '2026-11-13T15:00:00Z',
  },
];

const SEED_PAYMENTS: PaymentRecord[] = [
  {
    id: 'pay-1',
    jobId: 'job-101',
    jobTitle: 'White Oak Kitchen Cabinetry & Island',
    clientName: 'Elena Vance',
    type: 'Deposit',
    direction: 'inflow',
    amount: 7500,
    date: '2026-11-12',
    method: 'ACH',
    status: 'Paid',
    referenceNumber: 'QB-INV-4012',
    notes: '40% mobilization deposit for cabinet order',
    syncState: 'local',
  },
  {
    id: 'pay-2',
    jobId: 'job-101',
    jobTitle: 'White Oak Kitchen Cabinetry & Island',
    clientName: 'Pacific Millwork Supply',
    type: 'Material Expense',
    direction: 'outflow',
    amount: 6420,
    date: '2026-11-15',
    method: 'Credit Card',
    status: 'Paid',
    referenceNumber: 'PO-8831',
    notes: 'Rift-cut white oak cabinet boxes & Blum hardware',
    syncState: 'local',
  },
  {
    id: 'pay-3',
    jobId: 'job-102',
    jobTitle: 'Western Red Cedar Backyard Deck',
    clientName: 'Marcus Halvorsen',
    type: 'Deposit',
    direction: 'inflow',
    amount: 5680,
    date: '2026-11-16',
    method: 'Check',
    status: 'Paid',
    referenceNumber: 'CHK-1194',
    notes: '40% deck framing & lumber deposit',
    syncState: 'local',
  },
  {
    id: 'pay-4',
    jobId: 'job-102',
    jobTitle: 'Western Red Cedar Backyard Deck',
    clientName: 'Cascadia Lumber Co.',
    type: 'Material Expense',
    direction: 'outflow',
    amount: 4200,
    date: '2026-11-17',
    method: 'Credit Card',
    status: 'Paid',
    referenceNumber: 'INV-77201',
    notes: 'PT framing lumber, Simpson hardware & concrete',
    syncState: 'local',
  },
  {
    id: 'pay-5',
    jobId: 'job-103',
    jobTitle: '200A Main Service Panel Upgrade',
    clientName: 'Priya Deshmukh',
    type: 'Invoice Payment',
    direction: 'inflow',
    amount: 5400,
    date: '2026-11-14',
    method: 'QuickBooks Online',
    status: 'Paid',
    referenceNumber: 'QB-INV-4008',
    notes: 'Paid in full after final inspection sign-off',
    syncState: 'local',
  },
  {
    id: 'pay-6',
    jobId: 'job-101',
    jobTitle: 'White Oak Kitchen Cabinetry & Island',
    clientName: 'Elena Vance',
    type: 'Progress Draw',
    direction: 'inflow',
    amount: 5500,
    date: '2026-11-22',
    method: 'QuickBooks Online',
    status: 'Pending',
    referenceNumber: 'QB-INV-4019',
    notes: 'Cabinet hang completion milestone draw',
    syncState: 'local',
  },
];

const SEED_FILES: JobFile[] = [
  {
    id: 'file-1',
    jobId: 'job-101',
    name: 'kitchen-upper-cabinets-progress.jpg',
    category: 'Site Photo',
    mimeType: 'image/jpeg',
    sizeBytes: 2480000,
    uploadedAt: '2026-11-19T16:40:00Z',
    notes: 'Upper white oak boxes hung and leveled',
    localUrl: '/src/assets/images/job_kitchen_remodel_1795201225803.jpg',
    syncState: 'local',
  },
  {
    id: 'file-2',
    jobId: 'job-102',
    name: 'cedar-deck-joist-framing.jpg',
    category: 'Site Photo',
    mimeType: 'image/jpeg',
    sizeBytes: 3120000,
    uploadedAt: '2026-11-18T17:05:00Z',
    notes: 'Ledger flashing and joist hangers complete',
    localUrl: '/src/assets/images/job_cedar_deck_1795201226178.jpg',
    syncState: 'local',
  },
  {
    id: 'file-3',
    jobId: 'job-103',
    name: '200a-panel-final-termination.jpg',
    category: 'Site Photo',
    mimeType: 'image/jpeg',
    sizeBytes: 1940000,
    uploadedAt: '2026-11-13T14:55:00Z',
    notes: 'Final inspection approved photo',
    localUrl: '/src/assets/images/job_electrical_panel_1795201227328.jpg',
    syncState: 'local',
  },
  {
    id: 'file-4',
    jobId: 'job-101',
    name: 'Vance-Kitchen-Signed-Estimate-v2.pdf',
    category: 'Estimate & Contract',
    mimeType: 'application/pdf',
    sizeBytes: 425000,
    uploadedAt: '2026-11-11T10:15:00Z',
    notes: 'Client-signed fixed-bid contract and cabinet elevation sheet',
    syncState: 'local',
  },
  {
    id: 'file-5',
    jobId: 'job-102',
    name: 'Lake-Oswego-Deck-Permit-2026-441.pdf',
    category: 'Permit',
    mimeType: 'application/pdf',
    sizeBytes: 618000,
    uploadedAt: '2026-11-14T09:30:00Z',
    notes: 'Approved municipal structural deck permit',
    syncState: 'local',
  },
];

const SEED_CONTACTS: ClientContact[] = [];

export async function ensureSeededDatabase(): Promise<void> {
  const seeded = await getMeta('seeded_v1');
  if (!seeded) {
    await Promise.all([
      putMany('jobs', SEED_JOBS),
      putMany('scheduleBlocks', SEED_SCHEDULES),
      putMany('dailyLogs', SEED_LOGS),
      putMany('payments', SEED_PAYMENTS),
      putMany('files', SEED_FILES),
      putMany('contacts', SEED_CONTACTS),
    ]);
    await setMeta('seeded_v1', true);
    await setMeta('nextJobSeq', 5);
    await setMeta('job_id_seq_v1', true);
    await setMeta('cleared_contacts_v1', true);
    return;
  }

  const migratedSeq = await getMeta('job_id_seq_v1');
  if (!migratedSeq) {
    const existingJobs = await getAll<JobOrder>('jobs');
    const legacyMap: Record<string, string> = {
      'JO-2026-101': '#1',
      'JO-2026-102': '#2',
      'JO-2026-103': '#3',
      'JO-2026-104': '#4',
    };
    const updatedJobs = existingJobs.map((j) =>
      legacyMap[j.jobNumber] ? { ...j, jobNumber: legacyMap[j.jobNumber] } : j
    );
    await putMany('jobs', updatedJobs);
    const maxExisting = updatedJobs.reduce((max, j) => {
      const m = /^#(\d+)$/.exec(j.jobNumber.trim());
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    await setMeta('nextJobSeq', maxExisting + 1);
    await setMeta('job_id_seq_v1', true);
  }

  const clearedContactsV1 = await getMeta('cleared_contacts_v1');
  if (!clearedContactsV1) {
    await replaceStore('contacts', []);
    await setMeta('cleared_contacts_v1', true);
  }
}

async function computeNextSeq(): Promise<number> {
  const existingJobs = await getAll<JobOrder>('jobs');
  if (existingJobs.length === 0) {
    return 1;
  }
  const maxExisting = existingJobs.reduce((max, j) => {
    const m = /^#(\d+)$/.exec(j.jobNumber.trim());
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  const stored = Number(await getMeta('nextJobSeq')) || 1;
  return Math.max(stored, maxExisting + 1);
}

export const offlineDb = {
  peekNextJobNumber: async (): Promise<string> => {
    const seq = await computeNextSeq();
    return `#${seq}`;
  },
  getNextJobSeq: async (): Promise<number> => {
    return computeNextSeq();
  },
  setNextJobSeq: async (seq: number): Promise<void> => {
    const current = Number(await getMeta('nextJobSeq')) || 1;
    await setMeta('nextJobSeq', Math.max(current, seq));
  },
  allocateNextJobNumber: async (): Promise<string> => {
    const seq = await computeNextSeq();
    await setMeta('nextJobSeq', seq + 1);
    return `#${seq}`;
  },
  getJobs: async () => {
    const rows = await getAll<JobOrder>('jobs');
    return rows.map((j) => ({
      ...j,
      clientPhone: formatPhoneNumber(j.clientPhone),
      urgency: j.urgency || 2,
      materialsNeeded: j.materialsNeeded ?? Boolean(j.materialsList && j.materialsList.length > 0),
      materialsList: j.materialsList || [],
      status:
        (j.status as string) === 'Scheduled'
          ? ('Open' as const)
          : (j.status as string) === 'Completed'
          ? ('Complete' as const)
          : j.status,
    }));
  },
  saveJob: (job: JobOrder) => putItem('jobs', job),
  deleteJob: (id: string) => deleteItem('jobs', id),
  replaceJobsFromCloud: async (cloudJobs: JobOrder[]) => {
    const outbox = await getAll<SyncOutboxItem>('outbox');
    const localJobs = await getAll<JobOrder>('jobs');
    const merged = mergeWithPendingOutbox('jobs', cloudJobs, localJobs, outbox);
    await replaceStore('jobs', merged);
  },

  getDailyLogs: () => getAll<DailyLog>('dailyLogs'),
  saveDailyLog: (log: DailyLog) => putItem('dailyLogs', log),
  deleteDailyLog: (id: string) => deleteItem('dailyLogs', id),
  replaceDailyLogsFromCloud: async (cloudLogs: DailyLog[]) => {
    const outbox = await getAll<SyncOutboxItem>('outbox');
    const localLogs = await getAll<DailyLog>('dailyLogs');
    const merged = mergeWithPendingOutbox('dailyLogs', cloudLogs, localLogs, outbox);
    await replaceStore('dailyLogs', merged);
  },

  getScheduleBlocks: () => getAll<JobScheduleBlock>('scheduleBlocks'),
  saveScheduleBlock: (block: JobScheduleBlock) => putItem('scheduleBlocks', block),
  deleteScheduleBlock: (id: string) => deleteItem('scheduleBlocks', id),
  replaceSchedulesFromCloud: async (cloudSchedules: JobScheduleBlock[]) => {
    const outbox = await getAll<SyncOutboxItem>('outbox');
    const localSchedules = await getAll<JobScheduleBlock>('scheduleBlocks');
    const merged = mergeWithPendingOutbox('schedules', cloudSchedules, localSchedules, outbox);
    await replaceStore('scheduleBlocks', merged);
  },

  getPayments: () => getAll<PaymentRecord>('payments'),
  savePayment: (payment: PaymentRecord) => putItem('payments', payment),
  putManyPayments: (payments: PaymentRecord[]) => putMany('payments', payments),
  replacePaymentsFromCloud: async (cloudPayments: PaymentRecord[]) => {
    const outbox = await getAll<SyncOutboxItem>('outbox');
    const localPayments = await getAll<PaymentRecord>('payments');
    const merged = mergeWithPendingOutbox('payments', cloudPayments, localPayments, outbox);
    await replaceStore('payments', merged);
  },

  getFiles: () => getAll<JobFile>('files'),
  saveFile: (file: JobFile) => putItem('files', file),
  deleteFile: (id: string) => deleteItem('files', id),
  replaceFilesFromCloud: async (cloudFiles: JobFile[]) => {
    const outbox = await getAll<SyncOutboxItem>('outbox');
    const localFiles = await getAll<JobFile>('files');
    const localById = new Map(localFiles.map((f) => [f.id, f]));
    const enrichedCloud = cloudFiles.map((cf) => {
      const local = localById.get(cf.id);
      return local?.hasOfflineBlob ? { ...cf, hasOfflineBlob: true, localUrl: cf.localUrl || local.localUrl } : cf;
    });
    const merged = mergeWithPendingOutbox('files', enrichedCloud, localFiles, outbox);
    await replaceStore('files', merged);
  },

  getContacts: async () => {
    const rows = await getAll<ClientContact>('contacts');
    return rows.map((c) => ({
      ...c,
      phone: formatPhoneNumber(c.phone),
    }));
  },
  saveContact: (contact: ClientContact) => putItem('contacts', contact),
  putManyContacts: (contacts: ClientContact[]) => putMany('contacts', contacts),
  deleteContact: (id: string) => deleteItem('contacts', id),
  clearAllContacts: () => replaceStore('contacts', []),
  replaceContactsFromCloud: async (cloudContacts: ClientContact[]) => {
    const outbox = await getAll<SyncOutboxItem>('outbox');
    const localContacts = await getAll<ClientContact>('contacts');
    const merged = mergeWithPendingOutbox('contacts', cloudContacts, localContacts, outbox);
    await replaceStore('contacts', merged);
  },

  getCalendarCache: () => getAll<GoogleCalendarEvent>('calendarCache'),
  saveCalendarCache: (events: GoogleCalendarEvent[]) => putMany('calendarCache', events),

  getOutbox: () => getAll<SyncOutboxItem>('outbox'),
  addOutboxItem: (item: SyncOutboxItem) => putItem('outbox', item),
  removeOutboxItem: (id: string) => deleteItem('outbox', id),
};

function mergeWithPendingOutbox<T extends { id: string }>(
  collectionName: string,
  cloudItems: T[],
  localItems: T[],
  outbox: SyncOutboxItem[]
): T[] {
  const pendingDeleteIds = new Set(
    outbox
      .filter((o) => o.entityType === 'firestore-delete' && o.payload?.collection === collectionName)
      .map((o) => o.entityId)
  );
  const pendingUpsertIds = new Set(
    outbox
      .filter((o) => o.entityType === 'firestore-upsert' && o.payload?.collection === collectionName)
      .map((o) => o.entityId)
  );

  const localMap = new Map(localItems.map((item) => [item.id, item]));
  const resultMap = new Map<string, T>();

  for (const item of cloudItems) {
    if (pendingDeleteIds.has(item.id)) continue;
    if (pendingUpsertIds.has(item.id) && localMap.has(item.id)) {
      resultMap.set(item.id, localMap.get(item.id)!);
    } else {
      resultMap.set(item.id, item);
    }
  }

  for (const id of pendingUpsertIds) {
    const local = localMap.get(id);
    if (local && !pendingDeleteIds.has(id)) {
      resultMap.set(id, local);
    }
  }

  return Array.from(resultMap.values());
}
