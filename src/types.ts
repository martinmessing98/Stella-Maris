export type WorkspaceTab =
  | 'job-orders'
  | 'scheduling'
  | 'payments'
  | 'files'
  | 'profitability';

export type JobDetailTab = 'schedule' | 'logs' | 'info';

export type JobStatus = 'Open' | 'Estimate' | 'In Progress' | 'Complete' | 'On Hold';

export type UrgencyLevel = 1 | 2 | 3 | 4 | 5;

export interface MaterialNeedItem {
  id: string;
  quantity: string;
  item: string;
  obtained?: boolean;
}

export type TradeCategory =
  | 'Kitchen & Bath'
  | 'Carpentry & Deck'
  | 'Electrical'
  | 'Plumbing'
  | 'General Handyman'
  | 'Drywall & Paint';

export interface EstimateLineItem {
  id: string;
  category: 'Labor' | 'Materials' | 'Subcontractor' | 'Permits & Fees';
  description: string;
  estimatedCost: number;
  actualCost: number;
  billableAmount: number;
}

export interface JobOrder {
  id: string;
  jobNumber: string;
  title: string;
  trade: TradeCategory;
  status: JobStatus;
  urgency: UrgencyLevel;
  materialsNeeded?: boolean;
  materialsList?: MaterialNeedItem[];
  clientId?: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  siteAddress: string;
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  finishDate: string; // YYYY-MM-DD
  finishTime: string; // HH:mm
  estimatedRevenue: number;
  estimatedCost: number;
  actualCost: number;
  progressPercent: number;
  scopeSummary: string;
  lineItems: EstimateLineItem[];
  coverPhotoUrl?: string;
  driveFolderId?: string;
  updatedAt: string;
}

export interface JobScheduleBlock {
  id: string;
  jobId: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  crewAssigned: string;
  notes: string;
  googleEventId?: string;
  syncState: 'synced' | 'pending' | 'local';
}

export interface DailyLog {
  id: string;
  jobId: string;
  date: string; // YYYY-MM-DD
  author: string;
  weather: string;
  hoursWorked: number;
  progressPercent: number;
  workCompleted: string;
  materialsUsed: string;
  notes: string;
  photoIds: string[];
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  jobId: string;
  jobTitle: string;
  clientName: string;
  type: 'Invoice Payment' | 'Deposit' | 'Progress Draw' | 'Material Expense' | 'Subcontractor Payout';
  direction: 'inflow' | 'outflow';
  amount: number;
  date: string; // YYYY-MM-DD
  method: 'ACH' | 'Check' | 'Credit Card' | 'Cash' | 'QuickBooks Online';
  status: 'Paid' | 'Pending' | 'Overdue';
  referenceNumber: string;
  notes: string;
  quickbooksId?: string;
  syncState: 'synced' | 'pending' | 'local';
}

export interface JobFile {
  id: string;
  jobId: string;
  name: string;
  category: 'Site Photo' | 'Estimate & Contract' | 'Permit' | 'Blueprint / Plan' | 'Receipt';
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  notes?: string;
  localUrl?: string; // static or blob url cache key
  hasOfflineBlob?: boolean;
  driveFileId?: string;
  driveWebViewLink?: string;
  googlePhotosUrl?: string;
  syncState: 'synced' | 'pending' | 'local';
}

export interface GooglePhotoItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  createdTime?: string;
}

export interface ClientContact {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  company?: string;
  googleResourceName?: string;
  syncState: 'synced' | 'pending' | 'local';
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  htmlLink?: string;
}

export interface SyncOutboxItem {
  id: string;
  entityType:
    | 'calendar-create'
    | 'calendar-update'
    | 'drive-upload'
    | 'contact-create'
    | 'quickbooks-invoice'
    | 'firestore-upsert'
    | 'firestore-delete';
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  lastError?: string;
}

export interface QuickBooksStatus {
  configured: boolean;
  connected: boolean;
  environment: 'sandbox' | 'production';
  realmId: string | null;
  companyName: string | null;
  callbackUrl: string;
}
