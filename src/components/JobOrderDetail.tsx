import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  Trash2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import {
  formatCurrency,
  formatDateShort,
  formatPhoneInput,
  formatPhoneNumber,
  generateId,
  getGoogleMapsUrl,
  getTelHref,
  getUrgencyMeta,
  URGENCY_LEVELS,
} from '../lib/formatters';
import { getOfflineBlob } from '../lib/offlineDb';
import type {
  ClientContact,
  DailyLog,
  EstimateLineItem,
  JobDetailTab,
  JobFile,
  JobOrder,
  JobScheduleBlock,
  JobStatus,
  PaymentRecord,
  TradeCategory,
  UrgencyLevel,
} from '../types';
import { MaterialsListPanel } from './MaterialsListPanel';

interface JobOrderDetailProps {
  job: JobOrder;
  schedules: JobScheduleBlock[];
  dailyLogs: DailyLog[];
  payments: PaymentRecord[];
  files: JobFile[];
  googleConnected: boolean;
  isOnline: boolean;
  onBack: () => void;
  onUpdateJob: (updated: JobOrder) => Promise<void>;
  onDeleteJob: (job: JobOrder) => void;
  onAddScheduleBlock: (block: Omit<JobScheduleBlock, 'id' | 'syncState'>, syncToGoogle: boolean) => Promise<void>;
  onSyncScheduleBlock: (block: JobScheduleBlock) => Promise<void>;
  onDeleteScheduleBlock: (block: JobScheduleBlock) => Promise<void>;
  onAddDailyLog: (log: Omit<DailyLog, 'id' | 'createdAt'>, attachedFiles: File[]) => Promise<void>;
  onOpenContactPicker: (onSelect: (contact: ClientContact) => void) => void;
  onQuickRecordPayment: (job: JobOrder) => void;
}

const JOB_STATUSES: JobStatus[] = ['Open', 'Estimate', 'In Progress', 'Complete', 'On Hold'];
const TRADES: TradeCategory[] = [
  'Kitchen & Bath',
  'Carpentry & Deck',
  'Electrical',
  'Plumbing',
  'General Handyman',
  'Drywall & Paint',
];

export const JobOrderDetail: React.FC<JobOrderDetailProps> = ({
  job,
  schedules,
  dailyLogs,
  payments,
  files,
  googleConnected,
  isOnline,
  onBack,
  onUpdateJob,
  onDeleteJob,
  onAddScheduleBlock,
  onSyncScheduleBlock,
  onDeleteScheduleBlock,
  onAddDailyLog,
  onOpenContactPicker,
  onQuickRecordPayment,
}) => {
  const [activeTab, setActiveTab] = useState<JobDetailTab>('info');
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [materialsOpen, setMaterialsOpen] = useState(false);

  // Tab 1: Schedule Block Form State
  const [schedTitle, setSchedTitle] = useState('');
  const [schedDate, setSchedDate] = useState(job.startDate);
  const [schedStart, setSchedStart] = useState('08:00');
  const [schedEnd, setSchedEnd] = useState('16:00');
  const [schedCrew, setSchedCrew] = useState('Martin M.');
  const [schedNotes, setSchedNotes] = useState('');
  const [schedSyncGoogle, setSchedSyncGoogle] = useState(true);
  const [savingSched, setSavingSched] = useState(false);

  // Tab 2: Daily Log Form State
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [logWeather, setLogWeather] = useState('Clear · 55°F');
  const [logHours, setLogHours] = useState('8');
  const [logProgress, setLogProgress] = useState(String(job.progressPercent));
  const [logCompleted, setLogCompleted] = useState('');
  const [logMaterials, setLogMaterials] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [logPhotos, setLogPhotos] = useState<File[]>([]);
  const [savingLog, setSavingLog] = useState(false);

  // Tab 3: General Info & Estimate Form State
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editJob, setEditJob] = useState<JobOrder>(job);
  const [newLineCat, setNewLineCat] = useState<EstimateLineItem['category']>('Materials');
  const [newLineDesc, setNewLineDesc] = useState('');
  const [newLineEstCost, setNewLineEstCost] = useState('');
  const [newLineActCost, setNewLineActCost] = useState('');
  const [newLineBillable, setNewLineBillable] = useState('');
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    setEditJob(job);
    setLogProgress(String(job.progressPercent));
  }, [job]);

  useEffect(() => {
    setIsEditingInfo(false);
  }, [job.id]);

  useEffect(() => {
    let active = true;
    const urlsToRevoke: string[] = [];
    async function loadThumbnails() {
      const next: Record<string, string> = {};
      for (const f of files) {
        if (f.localUrl) {
          next[f.id] = f.localUrl;
        } else if (f.hasOfflineBlob) {
          const blob = await getOfflineBlob(f.id);
          if (blob && active) {
            const url = URL.createObjectURL(blob);
            urlsToRevoke.push(url);
            next[f.id] = url;
          }
        }
      }
      if (active) setBlobUrls(next);
    }
    loadThumbnails();
    return () => {
      active = false;
      for (const u of urlsToRevoke) URL.revokeObjectURL(u);
    };
  }, [files]);

  const jobSchedules = schedules
    .filter((s) => s.jobId === job.id)
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));

  const jobLogs = dailyLogs
    .filter((l) => l.jobId === job.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const jobPayments = payments.filter((p) => p.jobId === job.id);
  const totalCollected = jobPayments
    .filter((p) => p.direction === 'inflow' && p.status === 'Paid')
    .reduce((acc, p) => acc + p.amount, 0);

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedTitle.trim() || !schedDate) return;
    setSavingSched(true);
    try {
      await onAddScheduleBlock(
        {
          jobId: job.id,
          title: schedTitle.trim(),
          date: schedDate,
          startTime: schedStart,
          endTime: schedEnd,
          crewAssigned: schedCrew.trim() || 'Martin M.',
          notes: schedNotes.trim(),
        },
        schedSyncGoogle && googleConnected
      );
      setSchedTitle('');
      setSchedNotes('');
    } finally {
      setSavingSched(false);
    }
  };

  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logCompleted.trim()) return;
    setSavingLog(true);
    try {
      const pct = Math.min(100, Math.max(0, Number(logProgress) || 0));
      await onAddDailyLog(
        {
          jobId: job.id,
          date: logDate,
          author: 'Martin Messing',
          weather: logWeather.trim() || 'Clear',
          hoursWorked: Number(logHours) || 0,
          progressPercent: pct,
          workCompleted: logCompleted.trim(),
          materialsUsed: logMaterials.trim(),
          notes: logNotes.trim(),
          photoIds: [],
        },
        logPhotos
      );
      if (pct !== job.progressPercent) {
        await onUpdateJob({ ...job, progressPercent: pct, updatedAt: new Date().toISOString() });
      }
      setLogCompleted('');
      setLogMaterials('');
      setLogNotes('');
      setLogPhotos([]);
    } finally {
      setSavingLog(false);
    }
  };

  const handleAddLineItem = () => {
    if (!newLineDesc.trim()) return;
    const item: EstimateLineItem = {
      id: generateId('li'),
      category: newLineCat,
      description: newLineDesc.trim(),
      estimatedCost: Number(newLineEstCost) || 0,
      actualCost: Number(newLineActCost) || 0,
      billableAmount: Number(newLineBillable) || 0,
    };
    const nextItems = [...editJob.lineItems, item];
    const estimatedCost = nextItems.reduce((s, x) => s + x.estimatedCost, 0);
    const actualCost = nextItems.reduce((s, x) => s + x.actualCost, 0);
    const estimatedRevenue = nextItems.reduce((s, x) => s + x.billableAmount, 0);
    setEditJob({
      ...editJob,
      lineItems: nextItems,
      estimatedCost,
      actualCost,
      estimatedRevenue,
    });
    setNewLineDesc('');
    setNewLineEstCost('');
    setNewLineActCost('');
    setNewLineBillable('');
  };

  const handleRemoveLineItem = (id: string) => {
    const nextItems = editJob.lineItems.filter((li) => li.id !== id);
    const estimatedCost = nextItems.reduce((s, x) => s + x.estimatedCost, 0);
    const actualCost = nextItems.reduce((s, x) => s + x.actualCost, 0);
    const estimatedRevenue = nextItems.reduce((s, x) => s + x.billableAmount, 0);
    setEditJob({
      ...editJob,
      lineItems: nextItems,
      estimatedCost,
      actualCost,
      estimatedRevenue,
    });
  };

  const handleSaveJobInfo = async () => {
    const trimmedTitle = editJob.title.trim() || job.title;
    const clampedProgress = Math.min(100, Math.max(0, Number(editJob.progressPercent) || 0));
    await onUpdateJob({
      ...editJob,
      title: trimmedTitle,
      progressPercent: clampedProgress,
      updatedAt: new Date().toISOString(),
    });
    setIsEditingInfo(false);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2500);
  };

  const displayJob = isEditingInfo ? editJob : job;
  const displayProfit = displayJob.estimatedRevenue - displayJob.actualCost;
  const displayMarginPct =
    displayJob.estimatedRevenue > 0 ? Math.round((displayProfit / displayJob.estimatedRevenue) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Job Detail Header */}
      <div className="border-b border-slate-200 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All Job Orders
            </button>
            {savedBanner && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onQuickRecordPayment(job)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <DollarSign className="h-3.5 w-3.5 text-amber-400" />
              Record Payment
            </button>

            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-1">
              {!isEditingInfo ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditJob(job);
                    setIsEditingInfo(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-amber-500 hover:bg-amber-50 hover:text-amber-900 whitespace-nowrap shrink-0"
                >
                  <Pencil className="h-3.5 w-3.5 text-amber-600" />
                  Edit Job
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditJob(job);
                      setIsEditingInfo(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveJobInfo}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 whitespace-nowrap shrink-0"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save Changes
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onDeleteJob(job)}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 hover:border-red-300 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Job
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            {!isEditingInfo ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-700">{job.jobNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-slate-800">{job.status}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getUrgencyMeta(job.urgency).badgeClass}`}
                  >
                    <span className={`h-2 w-2 rounded-xs ${getUrgencyMeta(job.urgency).dotClass}`} />
                    {getUrgencyMeta(job.urgency).label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{job.progressPercent}% Complete</span>
                </div>
                <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-slate-900">
                  {job.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                  <span className="font-semibold text-slate-800">{job.clientName}</span>

                  <span className="text-slate-300" aria-hidden="true">·</span>

                  {getGoogleMapsUrl(job.siteAddress) ? (
                    <a
                      href={getGoogleMapsUrl(job.siteAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium text-amber-700 hover:text-amber-800 hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span>{job.siteAddress}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      No site address
                    </span>
                  )}

                  <span className="text-slate-300" aria-hidden="true">·</span>

                  {getTelHref(job.clientPhone) ? (
                    <a
                      href={getTelHref(job.clientPhone)}
                      className="inline-flex items-center gap-1.5 font-mono font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatPhoneNumber(job.clientPhone)}</span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      No phone
                    </span>
                  )}

                  {job.clientEmail && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <a
                        href={`mailto:${job.clientEmail}`}
                        className="inline-flex items-center gap-1.5 text-slate-700 hover:text-amber-700 hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>{job.clientEmail}</span>
                      </a>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-700">{editJob.jobNumber}</span>
                  <select
                    value={editJob.status}
                    onChange={(e) => setEditJob({ ...editJob, status: e.target.value as JobStatus })}
                    aria-label="Job status"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-amber-600 focus:outline-none"
                  >
                    {JOB_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editJob.urgency || 2}
                    onChange={(e) => setEditJob({ ...editJob, urgency: Number(e.target.value) as UrgencyLevel })}
                    aria-label="Priority level"
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold focus:outline-none ${getUrgencyMeta(editJob.urgency).badgeClass}`}
                  >
                    {URGENCY_LEVELS.map((u) => (
                      <option key={u.level} value={u.level} className="bg-white text-slate-900">
                        {u.label}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <span>Progress</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editJob.progressPercent}
                      onChange={(e) =>
                        setEditJob({
                          ...editJob,
                          progressPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                    />
                    <span>%</span>
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600">Job Title</label>
                  <input
                    type="text"
                    required
                    value={editJob.title}
                    onChange={(e) => setEditJob({ ...editJob, title: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-display text-base font-semibold text-slate-900 focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2 lg:col-span-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-medium text-slate-600">Client Name</label>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenContactPicker((c) =>
                            setEditJob({
                              ...editJob,
                              clientId: c.id,
                              clientName: c.name,
                              clientPhone: formatPhoneNumber(c.phone),
                              clientEmail: c.email,
                              siteAddress: editJob.siteAddress || c.address,
                            })
                          )
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800"
                      >
                        <UserCheck className="h-3 w-3" />
                        Contacts
                      </button>
                    </div>
                    <input
                      type="text"
                      value={editJob.clientName}
                      onChange={(e) => setEditJob({ ...editJob, clientName: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-1">
                    <label className="block text-[11px] font-medium text-slate-600">Site Address</label>
                    <input
                      type="text"
                      value={editJob.siteAddress}
                      onChange={(e) => setEditJob({ ...editJob, siteAddress: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">Phone</label>
                    <input
                      type="tel"
                      value={editJob.clientPhone}
                      onChange={(e) => setEditJob({ ...editJob, clientPhone: formatPhoneInput(e.target.value) })}
                      placeholder="503-555-0199"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">Email</label>
                    <input
                      type="email"
                      value={editJob.clientEmail}
                      onChange={(e) => setEditJob({ ...editJob, clientEmail: e.target.value })}
                      placeholder="client@email.com"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Compact Materials Needed Control between Job Info and Financials */}
          <div className="relative shrink-0 self-start lg:self-center">
            <button
              type="button"
              onClick={() => setMaterialsOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                displayJob.materialsNeeded || (displayJob.materialsList && displayJob.materialsList.length > 0)
                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Package className="h-3.5 w-3.5 shrink-0" />
              <span>Materials ({(displayJob.materialsList || []).length})</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${materialsOpen ? 'rotate-180' : ''}`} />
            </button>

            {materialsOpen && (
              <div className="absolute left-0 lg:left-1/2 lg:-translate-x-1/2 top-full z-40 mt-2 w-[min(92vw,420px)] rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl">
                <MaterialsListPanel
                  compact
                  readOnly={!isEditingInfo}
                  materialsNeeded={Boolean(
                    displayJob.materialsNeeded || (displayJob.materialsList && displayJob.materialsList.length > 0)
                  )}
                  items={displayJob.materialsList || []}
                  onChange={(nextNeeded, nextItems) =>
                    setEditJob({
                      ...editJob,
                      materialsNeeded: nextNeeded,
                      materialsList: nextItems,
                    })
                  }
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-5 border-t border-slate-200 pt-3 lg:border-t-0 lg:pt-0 shrink-0">
            <div>
              <div className="text-xs text-slate-500">Estimate</div>
              <div className="font-mono text-base font-semibold tabular-nums text-slate-900">
                {formatCurrency(displayJob.estimatedRevenue)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Actual Cost</div>
              <div className="font-mono text-base font-semibold tabular-nums text-slate-900">
                {formatCurrency(displayJob.actualCost)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Collected</div>
              <div className="font-mono text-base font-semibold tabular-nums text-emerald-700">
                {formatCurrency(totalCollected)}
              </div>
            </div>
          </div>
        </div>

        {/* The 3 Explicit Job Order Tabs */}
        <div className="mt-6 flex items-center gap-1 overflow-x-auto border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={() => setActiveTab('info')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'info'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Wrench className="h-4 w-4" />
            General Job Info
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'schedule'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Calendar className="h-4 w-4" />
            Scheduling
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'logs'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <FileText className="h-4 w-4" />
            Daily Logs &amp; Notes
          </button>
        </div>
      </div>

      {/* TAB 1: SCHEDULING ON THIS JOB */}
      {activeTab === 'schedule' && (() => {
        const toIso = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const parseNoon = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
        const todayIso = toIso(new Date());

        const allDates = [job.startDate, job.finishDate, ...jobSchedules.map((s) => s.date)].filter(Boolean).sort();
        const rawStart = allDates[0] || todayIso;
        const rawEnd = allDates[allDates.length - 1] || rawStart;
        const startD = parseNoon(rawStart);
        startD.setDate(startD.getDate() - 1);
        const endD = parseNoon(rawEnd);
        endD.setDate(endD.getDate() + 1);
        const totalSpan = Math.max(10, Math.min(35, Math.round((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1));

        const ganttCols = Array.from({ length: totalSpan }, (_, idx) => {
          const d = new Date(startD);
          d.setDate(startD.getDate() + idx);
          const iso = toIso(d);
          return {
            iso,
            dayNum: d.getDate(),
            weekday: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
            monthLabel: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            isWeekend: d.getDay() === 0 || d.getDay() === 6,
            isToday: iso === todayIso,
          };
        });

        const monthGroups: Array<{ label: string; count: number }> = [];
        for (const col of ganttCols) {
          const last = monthGroups[monthGroups.length - 1];
          if (last && last.label === col.monthLabel) last.count += 1;
          else monthGroups.push({ label: col.monthLabel, count: 1 });
        }

        const winStartIso = ganttCols[0].iso;
        const dayOffset = (iso: string) =>
          Math.round((parseNoon(iso).getTime() - parseNoon(winStartIso).getTime()) / (1000 * 60 * 60 * 24));
        const todayIdx = ganttCols.findIndex((c) => c.isToday);

        const jobStartIdx = Math.max(0, dayOffset(job.startDate || rawStart));
        const jobEndIdx = Math.min(totalSpan - 1, Math.max(jobStartIdx, dayOffset(job.finishDate || job.startDate || rawEnd)));
        const jobLeftPct = (jobStartIdx / totalSpan) * 100;
        const jobWidthPct = ((jobEndIdx - jobStartIdx + 1) / totalSpan) * 100;

        const barPalette =
          job.status === 'Complete'
            ? { track: 'bg-emerald-100 border-emerald-300', fill: 'bg-emerald-600', text: 'text-emerald-950' }
            : job.urgency === 5
            ? { track: 'bg-red-200 border-red-400', fill: 'bg-red-900', text: 'text-red-950' }
            : job.urgency === 4
            ? { track: 'bg-red-100 border-red-300', fill: 'bg-red-600', text: 'text-red-950' }
            : job.urgency === 3
            ? { track: 'bg-yellow-100 border-yellow-300', fill: 'bg-amber-500', text: 'text-amber-950' }
            : job.urgency === 1
            ? { track: 'bg-green-100 border-green-300', fill: 'bg-green-500', text: 'text-green-950' }
            : { track: 'bg-green-200 border-green-400', fill: 'bg-green-700', text: 'text-green-950' };

        return (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-xs font-semibold text-slate-900">Gantt Chart — {job.jobNumber} Schedule</div>
              <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                {formatDateShort(job.startDate)} – {formatDateShort(job.finishDate)} · {jobSchedules.length} shift(s)
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                {/* Header */}
                <div className="flex border-b border-slate-200 bg-slate-50/70">
                  <div className="sticky left-0 z-10 flex w-56 shrink-0 flex-col justify-end border-r border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
                    Task / Shift
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="grid border-b border-slate-200 text-[11px] font-semibold text-slate-700"
                      style={{ gridTemplateColumns: `repeat(${totalSpan}, minmax(0, 1fr))` }}
                    >
                      {monthGroups.map((grp, idx) => (
                        <div
                          key={`${grp.label}-${idx}`}
                          style={{ gridColumn: `span ${grp.count} / span ${grp.count}` }}
                          className="border-r border-slate-200 px-2 py-1 last:border-r-0 truncate"
                        >
                          {grp.label}
                        </div>
                      ))}
                    </div>
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: `repeat(${totalSpan}, minmax(0, 1fr))` }}
                    >
                      {ganttCols.map((col) => (
                        <div
                          key={col.iso}
                          className={`border-r border-slate-100 py-1 text-center last:border-r-0 ${
                            col.isToday
                              ? 'bg-amber-100/80 text-amber-900 font-bold'
                              : col.isWeekend
                              ? 'bg-slate-100/70 text-slate-400'
                              : 'text-slate-600'
                          }`}
                        >
                          <div className="text-[10px]">{col.weekday}</div>
                          <div className="font-mono text-[10px] font-semibold tabular-nums">{col.dayNum}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Job Overall Span Row */}
                <div className="flex items-stretch border-b border-slate-100">
                  <div className="sticky left-0 z-10 w-56 shrink-0 border-r border-slate-200 bg-white px-3 py-2.5">
                    <div className="font-mono text-[11px] font-semibold text-slate-800">{job.jobNumber} Overall Window</div>
                    <div className="text-[11px] text-slate-500 truncate">{job.progressPercent}% Complete · {job.status}</div>
                  </div>
                  <div className="relative flex flex-1 items-center min-h-[48px]">
                    <div
                      className="absolute inset-0 grid pointer-events-none"
                      style={{ gridTemplateColumns: `repeat(${totalSpan}, minmax(0, 1fr))` }}
                    >
                      {ganttCols.map((col) => (
                        <div
                          key={col.iso}
                          className={`border-r border-slate-100 last:border-r-0 ${
                            col.isToday ? 'bg-amber-50/40' : col.isWeekend ? 'bg-slate-50/60' : ''
                          }`}
                        />
                      ))}
                    </div>
                    {todayIdx >= 0 && (
                      <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-amber-500/75"
                        style={{ left: `${((todayIdx + 0.5) / totalSpan) * 100}%` }}
                      />
                    )}
                    <div
                      style={{ left: `${jobLeftPct}%`, width: `${jobWidthPct}%` }}
                      className={`absolute z-10 flex h-7 items-center overflow-hidden rounded-md border ${barPalette.track}`}
                    >
                      <div
                        className={`h-full ${barPalette.fill}`}
                        style={{ width: `${Math.min(100, Math.max(0, job.progressPercent || 0))}%` }}
                      />
                      <span
                        className={`absolute inset-x-2 truncate font-mono text-[11px] font-semibold tabular-nums ${
                          job.progressPercent >= 40 ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]' : barPalette.text
                        }`}
                      >
                        {job.title} ({job.progressPercent}%)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Shift Rows */}
                {jobSchedules.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-slate-500 bg-slate-50/30">
                    No crew shifts added yet — use the form below to plot shifts on this Gantt timeline.
                  </div>
                ) : (
                  jobSchedules.map((block) => {
                    const sIdx = dayOffset(block.date);
                    const visible = sIdx >= 0 && sIdx < totalSpan;
                    return (
                      <div key={`gantt-row-${block.id}`} className="flex items-stretch border-b border-slate-100 last:border-b-0 bg-slate-50/30">
                        <div className="sticky left-0 z-10 w-56 shrink-0 border-r border-slate-200 bg-slate-50/95 px-3 py-2">
                          <div className="text-xs font-medium text-slate-800 truncate">{block.title}</div>
                          <div className="font-mono text-[10px] text-slate-500 tabular-nums truncate">
                            {block.startTime}–{block.endTime} · {block.crewAssigned}
                          </div>
                        </div>
                        <div className="relative flex flex-1 items-center min-h-[42px]">
                          <div
                            className="absolute inset-0 grid pointer-events-none"
                            style={{ gridTemplateColumns: `repeat(${totalSpan}, minmax(0, 1fr))` }}
                          >
                            {ganttCols.map((col) => (
                              <div
                                key={col.iso}
                                className={`border-r border-slate-100 last:border-r-0 ${
                                  col.isToday ? 'bg-amber-50/40' : col.isWeekend ? 'bg-slate-50/60' : ''
                                }`}
                              />
                            ))}
                          </div>
                          {todayIdx >= 0 && (
                            <div
                              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-amber-500/75"
                              style={{ left: `${((todayIdx + 0.5) / totalSpan) * 100}%` }}
                            />
                          )}
                          {visible && (
                            <div
                              style={{ left: `${(sIdx / totalSpan) * 100}%`, width: `${(1 / totalSpan) * 100}%` }}
                              className="absolute z-10 flex h-5 items-center justify-center rounded border border-amber-400 bg-amber-100 px-1 font-mono text-[10px] font-semibold text-amber-900"
                              title={`${block.title} (${block.startTime}–${block.endTime} · ${block.crewAssigned})`}
                            >
                              <span className="truncate">{block.startTime}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Scheduled Shifts &amp; Milestones
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {jobSchedules.length} shift(s)
              </span>
            </div>

            {jobSchedules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <p className="text-sm font-medium text-slate-700">No crew shifts scheduled on this job yet.</p>
                <p className="mt-1 text-xs text-slate-500">
                  Add a site visit or work block on the right and optionally push it to Google Calendar.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {jobSchedules.map((block) => (
                  <div key={block.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-800 tabular-nums">
                          {formatDateShort(block.date)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {block.startTime}–{block.endTime}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Crew: {block.crewAssigned}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-medium ${
                            block.syncState === 'synced'
                              ? 'text-emerald-700'
                              : block.syncState === 'pending'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {block.syncState === 'synced'
                            ? 'Synced to Google Calendar'
                            : block.syncState === 'pending'
                            ? 'Queued for Calendar'
                            : 'Local Only'}
                        </span>
                      </div>
                      <h3 className="font-medium text-slate-900">{block.title}</h3>
                      {block.notes && <p className="text-xs leading-relaxed text-slate-600">{block.notes}</p>}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {block.syncState !== 'synced' && (
                        <button
                          type="button"
                          onClick={() => onSyncScheduleBlock(block)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-amber-500 hover:bg-amber-50 whitespace-nowrap"
                        >
                          Sync to Google
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteScheduleBlock(block)}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete schedule block ${block.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleScheduleSubmit} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-5 h-fit">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Add Schedule Block for {job.jobNumber}
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-700">Task / Site Visit Title *</label>
              <input
                type="text"
                required
                value={schedTitle}
                onChange={(e) => setSchedTitle(e.target.value)}
                placeholder="e.g. Drywall mudding & sand pass 1"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3 sm:col-span-1">
                <label className="block text-xs font-medium text-slate-700">Date *</label>
                <input
                  type="date"
                  required
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Start</label>
                <input
                  type="time"
                  value={schedStart}
                  onChange={(e) => setSchedStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Finish</label>
                <input
                  type="time"
                  value={schedEnd}
                  onChange={(e) => setSchedEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Assigned Crew / Subcontractor</label>
              <input
                type="text"
                value={schedCrew}
                onChange={(e) => setSchedCrew(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Access / Gate / Prep Notes</label>
              <textarea
                rows={2}
                value={schedNotes}
                onChange={(e) => setSchedNotes(e.target.value)}
                placeholder="Lockbox code, material staging notes..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={schedSyncGoogle}
                onChange={(e) => setSchedSyncGoogle(e.target.checked)}
                disabled={!googleConnected}
                className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-600"
              />
              {googleConnected
                ? isOnline
                  ? 'Push event to Google Calendar (asks confirmation)'
                  : 'Offline: Queue event for Google Calendar sync'
                : 'Sign in with Google to sync to Google Calendar'}
            </label>

            <button
              type="submit"
              disabled={savingSched}
              className="w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              {savingSched ? 'Saving...' : 'Schedule Shift'}
            </button>
          </form>
        </div>
        </div>
        );
      })()}

      {/* TAB 2: DAILY LOGS, PROGRESS & NOTES */}
      {activeTab === 'logs' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            {files.some((f) => f.mimeType.startsWith('image/')) && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Job Site Photos
                  </h2>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {files.filter((f) => f.mimeType.startsWith('image/')).length} photo(s)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {files
                    .filter((f) => f.mimeType.startsWith('image/'))
                    .map((f) => {
                      const src = blobUrls[f.id] || f.localUrl || f.googlePhotosUrl;
                      return (
                        <div key={f.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                          {src ? (
                            <img
                              src={src}
                              alt={f.name}
                              referrerPolicy="no-referrer"
                              className="h-24 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-24 items-center justify-center px-2 text-center text-xs text-slate-500">
                              {f.name}
                            </div>
                          )}
                          <div className="truncate bg-white px-2 py-1 text-[11px] text-slate-600">{f.name}</div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Field Daily Logs &amp; Site Photos
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {jobLogs.length} log entries
              </span>
            </div>

            {jobLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <p className="text-sm font-medium text-slate-700">No daily field logs recorded yet.</p>
                <p className="mt-1 text-xs text-slate-500">
                  Log work completed, crew hours, materials used, and site photos — even offline on remote job sites.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {jobLogs.map((log) => {
                  const attachedFiles = files.filter((f) => log.photoIds.includes(f.id));
                  return (
                    <article key={log.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatDateShort(log.date)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{log.author}</span>
                          <span aria-hidden="true">·</span>
                          <span>{log.weather}</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono tabular-nums text-slate-700">
                          <span>{log.hoursWorked} hrs</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-amber-700">{log.progressPercent}% progress</span>
                        </div>
                      </div>

                      <p className="text-sm leading-relaxed text-slate-900">{log.workCompleted}</p>

                      {log.materialsUsed && (
                        <p className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">Materials:</span> {log.materialsUsed}
                        </p>
                      )}

                      {log.notes && (
                        <p className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">Field Notes:</span> {log.notes}
                        </p>
                      )}

                      {attachedFiles.length > 0 && (
                        <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
                          {attachedFiles.map((f) => {
                            const src = blobUrls[f.id] || f.localUrl || f.googlePhotosUrl;
                            return (
                              <div key={f.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                                {src ? (
                                  <img
                                    src={src}
                                    alt={f.name}
                                    referrerPolicy="no-referrer"
                                    className="h-28 w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-28 items-center justify-center text-xs text-slate-500">
                                    {f.name}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <form onSubmit={handleLogSubmit} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-5 h-fit">
            <h3 className="font-display text-sm font-semibold text-slate-900">Record Daily Field Log</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Log Date</label>
                <input
                  type="date"
                  required
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Weather / Site</label>
                <input
                  type="text"
                  value={logWeather}
                  onChange={(e) => setLogWeather(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Crew Hours</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={logHours}
                  onChange={(e) => setLogHours(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Progress ({logProgress}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={logProgress}
                  onChange={(e) => setLogProgress(e.target.value)}
                  className="mt-3 w-full accent-amber-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Work Completed Today *</label>
              <textarea
                rows={3}
                required
                value={logCompleted}
                onChange={(e) => setLogCompleted(e.target.value)}
                placeholder="Describe framing, electrical rough-in, trim installed..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Materials Used</label>
              <input
                type="text"
                value={logMaterials}
                onChange={(e) => setLogMaterials(e.target.value)}
                placeholder="Lumber, fasteners, drywall sheets..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Issues / Inspection Notes</label>
              <textarea
                rows={2}
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                placeholder="Change orders requested, inspector notes, follow-ups..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Attach Site Photos (Offline-Ready, Syncs to Google Drive)
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-700 transition-colors hover:border-amber-500 hover:bg-amber-50">
                <Camera className="h-4 w-4 text-amber-600" />
                <span>
                  {logPhotos.length > 0
                    ? `${logPhotos.length} photo(s) selected`
                    : 'Capture or choose job-site photos'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  onChange={(e) => setLogPhotos(Array.from(e.target.files || []))}
                  className="hidden"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={savingLog}
              className="w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              {savingLog ? 'Saving Log...' : 'Save Daily Log'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 1: GENERAL JOB INFO (Read-Only by default unless top-right Edit Job is clicked) */}
      {activeTab === 'info' && !isEditingInfo && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: Dates, Category & Notes (no fields repeated from header) */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5 lg:col-span-7">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div>
                  <div className="text-xs font-medium text-slate-500">Start Date</div>
                  <div className="mt-1 font-mono text-sm font-medium text-slate-900">
                    {formatDateShort(job.startDate)}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-slate-500">Finish Date</div>
                  <div className="mt-1 font-mono text-sm font-medium text-slate-900">
                    {formatDateShort(job.finishDate)}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-slate-500">Category</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{job.trade}</div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="text-xs font-medium text-slate-500">Job Notes &amp; Specifications</div>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                  {job.scopeSummary?.trim() || 'No job notes added yet.'}
                </p>
              </div>
            </div>

            {/* Right: Non-repeated Cost & Profit Breakdown */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between space-y-4 lg:col-span-5">
              <div className="space-y-4">
                <h3 className="font-display text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2.5">
                  Cost &amp; Profit Summary
                </h3>
                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <div className="text-xs text-slate-500">Estimated Cost</div>
                    <div className="font-mono text-lg font-bold tabular-nums text-slate-800">
                      {formatCurrency(job.estimatedCost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Projected Gross Profit</div>
                    <div
                      className={`font-mono text-lg font-bold tabular-nums ${
                        displayProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {formatCurrency(displayProfit)} ({displayMarginPct}%)
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                <span>Last updated {formatDateShort(job.updatedAt)}</span>
              </div>
            </div>
          </div>

          {/* Read-only Estimate Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Estimate vs. Actual Cost Breakdown
              </h3>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {job.lineItems.length} item(s)
              </span>
            </div>

            {job.lineItems.length === 0 ? (
              <div className="px-6 py-8 text-center text-xs text-slate-500">
                No estimate line items added yet. Click <span className="font-semibold text-slate-700">Edit Job</span> in the top right to add costs or pricing.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3">Description</th>
                      <th className="px-6 py-3 text-right">Est. Cost</th>
                      <th className="px-6 py-3 text-right">Actual Cost</th>
                      <th className="px-6 py-3 text-right">Client Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {job.lineItems.map((li) => (
                      <tr key={li.id}>
                        <td className="px-6 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                          {li.category}
                        </td>
                        <td className="px-6 py-3 text-slate-900">{li.description}</td>
                        <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-700">
                          {formatCurrency(li.estimatedCost)}
                        </td>
                        <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-900">
                          {formatCurrency(li.actualCost)}
                        </td>
                        <td className="px-6 py-3 text-right font-mono font-medium tabular-nums text-slate-900">
                          {formatCurrency(li.billableAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: GENERAL JOB INFO (Edit Mode controlled by top-right Edit Job) */}
      {activeTab === 'info' && isEditingInfo && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-7">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Start Date</label>
                  <input
                    type="date"
                    value={editJob.startDate}
                    onChange={(e) => setEditJob({ ...editJob, startDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Finish Date</label>
                  <input
                    type="date"
                    value={editJob.finishDate}
                    onChange={(e) => setEditJob({ ...editJob, finishDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Category</label>
                  <select
                    value={editJob.trade}
                    onChange={(e) => setEditJob({ ...editJob, trade: e.target.value as TradeCategory })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                  >
                    {TRADES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700">Job Notes &amp; Specifications</label>
                  <textarea
                    rows={4}
                    value={editJob.scopeSummary}
                    onChange={(e) => setEditJob({ ...editJob, scopeSummary: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between space-y-4 lg:col-span-5">
              <div className="space-y-3">
                <h3 className="font-display text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2.5">
                  Cost &amp; Profit Summary
                </h3>
                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <div className="text-xs text-slate-500">Estimated Cost</div>
                    <div className="font-mono text-lg font-bold tabular-nums text-slate-800">
                      {formatCurrency(editJob.estimatedCost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Projected Gross Profit</div>
                    <div
                      className={`font-mono text-lg font-bold tabular-nums ${
                        displayProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {formatCurrency(displayProfit)} ({displayMarginPct}%)
                    </div>
                  </div>
                </div>
              </div>
              <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                Totals update automatically as you edit line items below.
              </p>
            </div>
          </div>

          {/* Itemized Estimate & Cost Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Estimate vs. Actual Cost Breakdown
                </h3>
                <p className="text-xs text-slate-500">
                  Edit line-item descriptions, costs, or pricing; header and profit totals recalculate automatically.
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {editJob.lineItems.length} item(s)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Description</th>
                    <th className="px-5 py-3 text-right">Est. Cost</th>
                    <th className="px-5 py-3 text-right">Actual Cost</th>
                    <th className="px-5 py-3 text-right">Client Price</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editJob.lineItems.map((li) => (
                    <tr key={li.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-2.5 text-xs font-medium text-slate-700 whitespace-nowrap">
                        <select
                          value={li.category}
                          onChange={(e) => {
                            const nextItems = editJob.lineItems.map((row) =>
                              row.id === li.id
                                ? { ...row, category: e.target.value as EstimateLineItem['category'] }
                                : row
                            );
                            setEditJob({ ...editJob, lineItems: nextItems });
                          }}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-amber-600 focus:outline-none"
                        >
                          <option value="Materials">Materials</option>
                          <option value="Labor">Labor</option>
                          <option value="Subcontractor">Subcontractor</option>
                          <option value="Permits & Fees">Permits &amp; Fees</option>
                        </select>
                      </td>
                      <td className="px-5 py-2.5 text-slate-900">
                        <input
                          type="text"
                          value={li.description}
                          onChange={(e) => {
                            const nextItems = editJob.lineItems.map((row) =>
                              row.id === li.id ? { ...row, description: e.target.value } : row
                            );
                            setEditJob({ ...editJob, lineItems: nextItems });
                          }}
                          className="w-full min-w-[160px] rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                        />
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular-nums text-slate-700">
                        <input
                          type="number"
                          value={li.estimatedCost}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            const nextItems = editJob.lineItems.map((row) =>
                              row.id === li.id ? { ...row, estimatedCost: val } : row
                            );
                            setEditJob({
                              ...editJob,
                              lineItems: nextItems,
                              estimatedCost: nextItems.reduce((s, x) => s + x.estimatedCost, 0),
                            });
                          }}
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-amber-600 focus:outline-none"
                        />
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular-nums text-slate-900">
                        <input
                          type="number"
                          value={li.actualCost}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            const nextItems = editJob.lineItems.map((row) =>
                              row.id === li.id ? { ...row, actualCost: val } : row
                            );
                            setEditJob({
                              ...editJob,
                              lineItems: nextItems,
                              actualCost: nextItems.reduce((s, x) => s + x.actualCost, 0),
                            });
                          }}
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-amber-600 focus:outline-none"
                        />
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono font-medium tabular-nums text-slate-900">
                        <input
                          type="number"
                          value={li.billableAmount}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            const nextItems = editJob.lineItems.map((row) =>
                              row.id === li.id ? { ...row, billableAmount: val } : row
                            );
                            setEditJob({
                              ...editJob,
                              lineItems: nextItems,
                              estimatedRevenue: nextItems.reduce((s, x) => s + x.billableAmount, 0),
                            });
                          }}
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-amber-600 focus:outline-none"
                        />
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveLineItem(li.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove line item ${li.description}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                <select
                  value={newLineCat}
                  onChange={(e) => setNewLineCat(e.target.value as EstimateLineItem['category'])}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 sm:col-span-2"
                >
                  <option value="Materials">Materials</option>
                  <option value="Labor">Labor</option>
                  <option value="Subcontractor">Subcontractor</option>
                  <option value="Permits & Fees">Permits &amp; Fees</option>
                </select>
                <input
                  type="text"
                  value={newLineDesc}
                  onChange={(e) => setNewLineDesc(e.target.value)}
                  placeholder="Add line item description..."
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 sm:col-span-4"
                />
                <input
                  type="number"
                  value={newLineEstCost}
                  onChange={(e) => setNewLineEstCost(e.target.value)}
                  placeholder="Est. Cost $"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 sm:col-span-2"
                />
                <input
                  type="number"
                  value={newLineActCost}
                  onChange={(e) => setNewLineActCost(e.target.value)}
                  placeholder="Actual $"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 sm:col-span-2"
                />
                <div className="flex gap-2 sm:col-span-2">
                  <input
                    type="number"
                    value={newLineBillable}
                    onChange={(e) => setNewLineBillable(e.target.value)}
                    placeholder="Price $"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 shrink-0"
                    aria-label="Add estimate line item"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
