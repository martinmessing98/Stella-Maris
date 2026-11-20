import React, { useEffect, useState } from 'react';
import {
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Image as ImageIcon,
  MapPin,
  Package,
  Plus,
  Search,
  Trash2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import {
  formatBytes,
  formatCurrency,
  formatDateShort,
  formatPhoneInput,
  formatPhoneNumber,
  generateId,
  getUrgencyMeta,
  URGENCY_LEVELS,
} from '../lib/formatters';
import { getOfflineBlob, offlineDb } from '../lib/offlineDb';
import type {
  ClientContact,
  GooglePhotoItem,
  JobFile,
  JobOrder,
  JobStatus,
  MaterialNeedItem,
  UrgencyLevel,
} from '../types';
import { MaterialsListPanel } from './MaterialsListPanel';

type JobSortMode = 'urgency-desc' | 'urgency-asc' | 'materials-first' | 'recent';

interface JobOrdersViewProps {
  jobs: JobOrder[];
  files: JobFile[];
  googleConnected: boolean;
  isOnline: boolean;
  onOpenJob: (jobId: string) => void;
  onCreateJob: (job: JobOrder, photos: File[], googlePhotos: GooglePhotoItem[]) => Promise<void>;
  onUpdateJob: (updated: JobOrder) => Promise<void>;
  onOpenContactPicker: (onSelect: (contact: ClientContact) => void) => void;
  onBrowseGooglePhotos: () => Promise<GooglePhotoItem[]>;
  onGoogleSignIn: () => Promise<void>;
}

const STATUS_FILTERS: Array<'All' | JobStatus> = ['All', 'Open', 'Estimate', 'In Progress', 'Complete', 'On Hold'];

export const JobOrdersView: React.FC<JobOrdersViewProps> = ({
  jobs,
  files,
  googleConnected,
  isOnline,
  onOpenJob,
  onCreateJob,
  onUpdateJob,
  onOpenContactPicker,
  onBrowseGooglePhotos,
  onGoogleSignIn,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | JobStatus>('All');
  const [materialsFilter, setMaterialsFilter] = useState<'all' | 'needed'>('all');
  const [sortMode, setSortMode] = useState<JobSortMode>('urgency-desc');
  const [expandedMaterialsJobId, setExpandedMaterialsJobId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [blobThumbs, setBlobThumbs] = useState<Record<string, string>>({});

  // New Job Form
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<JobStatus>('Open');
  const [urgency, setUrgency] = useState<UrgencyLevel>(3);
  const [materialsNeeded, setMaterialsNeeded] = useState(false);
  const [materialsList, setMaterialsList] = useState<MaterialNeedItem[]>([]);
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [finishDate, setFinishDate] = useState(new Date().toISOString().slice(0, 10));
  const [jobNotes, setJobNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [localPhotoPreviews, setLocalPhotoPreviews] = useState<string[]>([]);
  const [selectedGooglePhotos, setSelectedGooglePhotos] = useState<GooglePhotoItem[]>([]);
  const [showGooglePhotosPicker, setShowGooglePhotosPicker] = useState(false);
  const [googlePhotosLibrary, setGooglePhotosLibrary] = useState<GooglePhotoItem[]>([]);
  const [loadingGooglePhotos, setLoadingGooglePhotos] = useState(false);
  const [googlePhotosError, setGooglePhotosError] = useState<string | null>(null);
  const [photoSearch, setPhotoSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nextJobIdLabel, setNextJobIdLabel] = useState('#1');

  useEffect(() => {
    if (showCreateModal) {
      offlineDb.peekNextJobNumber().then(setNextJobIdLabel);
    }
  }, [showCreateModal, jobs.length]);

  useEffect(() => {
    const urls = photos.map((file) => URL.createObjectURL(file));
    setLocalPhotoPreviews(urls);
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [photos]);

  useEffect(() => {
    let active = true;
    const toRevoke: string[] = [];
    async function loadCoverThumbnails() {
      const next: Record<string, string> = {};
      for (const job of jobs) {
        if (job.coverPhotoUrl) continue;
        const firstPhoto = files.find((f) => f.jobId === job.id && f.mimeType.startsWith('image/'));
        if (!firstPhoto) continue;
        if (firstPhoto.localUrl) {
          next[job.id] = firstPhoto.localUrl;
        } else if (firstPhoto.googlePhotosUrl) {
          next[job.id] = firstPhoto.googlePhotosUrl;
        } else if (firstPhoto.hasOfflineBlob) {
          const blob = await getOfflineBlob(firstPhoto.id);
          if (blob && active) {
            const url = URL.createObjectURL(blob);
            toRevoke.push(url);
            next[job.id] = url;
          }
        }
      }
      if (active) setBlobThumbs(next);
    }
    loadCoverThumbnails();
    return () => {
      active = false;
      for (const u of toRevoke) URL.revokeObjectURL(u);
    };
  }, [jobs, files]);

  const filtered = jobs
    .filter((j) => (statusFilter === 'All' ? true : j.status === statusFilter))
    .filter((j) => (materialsFilter === 'needed' ? Boolean(j.materialsNeeded || (j.materialsList && j.materialsList.length > 0)) : true))
    .filter((j) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        j.title.toLowerCase().includes(q) ||
        j.jobNumber.toLowerCase().includes(q) ||
        j.clientName.toLowerCase().includes(q) ||
        j.siteAddress.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const ua = a.urgency || 2;
      const ub = b.urgency || 2;
      if (sortMode === 'urgency-desc') {
        if (ub !== ua) return ub - ua;
      } else if (sortMode === 'urgency-asc') {
        if (ua !== ub) return ua - ub;
      } else if (sortMode === 'materials-first') {
        const ma = Number(Boolean(a.materialsNeeded || (a.materialsList && a.materialsList.length > 0)));
        const mb = Number(Boolean(b.materialsNeeded || (b.materialsList && b.materialsList.length > 0)));
        if (mb !== ma) return mb - ma;
        if (ub !== ua) return ub - ua;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const resetCreateForm = () => {
    setTitle('');
    setStatus('Open');
    setUrgency(3);
    setMaterialsNeeded(false);
    setMaterialsList([]);
    setClientId(undefined);
    setClientName('');
    setClientPhone('');
    setClientEmail('');
    setSiteAddress('');
    setJobNotes('');
    setPhotos([]);
    setSelectedGooglePhotos([]);
    setShowGooglePhotosPicker(false);
    setGooglePhotosError(null);
    setPhotoSearch('');
  };

  const handleOpenGooglePhotosPicker = async () => {
    if (!googleConnected) {
      await onGoogleSignIn();
      return;
    }
    setShowGooglePhotosPicker(true);
    setLoadingGooglePhotos(true);
    setGooglePhotosError(null);
    try {
      const items = await onBrowseGooglePhotos();
      setGooglePhotosLibrary(items);
    } catch (err) {
      setGooglePhotosError(err instanceof Error ? err.message : 'Unable to load Google Photos.');
    } finally {
      setLoadingGooglePhotos(false);
    }
  };

  const toggleGooglePhotoSelection = (photo: GooglePhotoItem) => {
    setSelectedGooglePhotos((prev) => {
      const exists = prev.some((p) => p.id === photo.id);
      return exists ? prev.filter((p) => p.id !== photo.id) : [...prev, photo];
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !clientName.trim()) return;
    setSubmitting(true);
    try {
      const assignedJobNumber = await offlineDb.allocateNextJobNumber();
      const newJob: JobOrder = {
        id: generateId('job'),
        jobNumber: assignedJobNumber,
        title: title.trim(),
        trade: 'General Handyman',
        status,
        urgency,
        materialsNeeded,
        materialsList,
        clientId,
        clientName: clientName.trim(),
        clientPhone: formatPhoneNumber(clientPhone),
        clientEmail: clientEmail.trim(),
        siteAddress: siteAddress.trim() || 'Client site address',
        startDate,
        startTime: '',
        finishDate,
        finishTime: '',
        estimatedRevenue: 0,
        estimatedCost: 0,
        actualCost: 0,
        progressPercent: status === 'Complete' ? 100 : 0,
        scopeSummary: jobNotes.trim() || '',
        lineItems: [],
        updatedAt: new Date().toISOString(),
      };
      await onCreateJob(newJob, photos, selectedGooglePhotos);
      setShowCreateModal(false);
      resetCreateForm();
      onOpenJob(newJob.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Job Orders</h1>
          <p className="text-sm text-slate-600">
            Open any job order to manage its schedule, daily field logs, and estimate breakdown.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          New Job
        </button>
      </div>

      {/* Filter, Sort & Search Toolbar */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
            {STATUS_FILTERS.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === st
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as JobSortMode)}
              aria-label="Sort job orders"
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none"
            >
              <option value="urgency-desc">Sort: Urgency (5 ASAP → 1 Low)</option>
              <option value="urgency-asc">Sort: Urgency (1 Low → 5 ASAP)</option>
              <option value="materials-first">Sort: Materials Needed First</option>
              <option value="recent">Sort: Recently Updated</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
            <Package className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <select
              value={materialsFilter}
              onChange={(e) => setMaterialsFilter(e.target.value as 'all' | 'needed')}
              aria-label="Filter by materials needed"
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none"
            >
              <option value="all">Materials: All Jobs</option>
              <option value="needed">Materials Needed Only</option>
            </select>
          </div>
        </div>

        <div className="relative w-full xl:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job #, title, client, address..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Job Orders Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-800">No job orders match this view</p>
          <p className="mt-1 text-xs text-slate-500">
            Adjust the status filter or create a new job to start tracking schedules and costs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {filtered.map((job) => {
            const margin =
              job.estimatedRevenue > 0
                ? Math.round(((job.estimatedRevenue - job.actualCost) / job.estimatedRevenue) * 100)
                : 0;
            const thumbSrc = job.coverPhotoUrl || blobThumbs[job.id];
            const urgencyMeta = getUrgencyMeta(job.urgency);
            const jobMaterials = job.materialsList || [];
            const hasMaterialsNeeded = Boolean(job.materialsNeeded || jobMaterials.length > 0);
            const isMaterialsExpanded = expandedMaterialsJobId === job.id;

            return (
              <div
                key={job.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-amber-500"
              >
                <button
                  type="button"
                  onClick={() => onOpenJob(job.id)}
                  className="flex items-stretch gap-4 p-5 pb-3 text-left focus-visible:outline-2 focus-visible:outline-amber-600"
                >
                  <div className="h-24 w-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={job.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400">
                        <Wrench className="h-6 w-6" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-mono font-semibold text-slate-700">{job.jobNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${urgencyMeta.badgeClass}`}
                          title={urgencyMeta.label}
                        >
                          <span className={`h-2 w-2 rounded-xs ${urgencyMeta.dotClass}`} />
                          {urgencyMeta.shortLabel}
                        </span>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-amber-600 shrink-0" />
                    </div>

                    <h2 className="mt-1.5 font-display text-base font-semibold text-slate-900 truncate">
                      {job.title}
                    </h2>
                    <p className="mt-1 text-xs font-medium text-slate-700 truncate">{job.clientName}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {job.siteAddress}
                    </p>
                  </div>
                </button>

                {/* Status (Read-Only) + Sortable Materials Needed Dropdown Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-2.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">Status:</span>
                    <span
                      className={`font-semibold ${
                        job.status === 'Complete'
                          ? 'text-emerald-700'
                          : job.status === 'In Progress'
                          ? 'text-amber-700'
                          : job.status === 'On Hold'
                          ? 'text-red-600'
                          : 'text-slate-800'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedMaterialsJobId(isMaterialsExpanded ? null : job.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      hasMaterialsNeeded
                        ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Package className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {hasMaterialsNeeded
                        ? `Materials Needed (${jobMaterials.length})`
                        : 'Materials Needed'}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${isMaterialsExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {isMaterialsExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50/90 px-5 py-3.5">
                    <MaterialsListPanel
                      compact
                      materialsNeeded={hasMaterialsNeeded}
                      items={jobMaterials}
                      onChange={(nextNeeded, nextItems) =>
                        onUpdateJob({
                          ...job,
                          materialsNeeded: nextNeeded,
                          materialsList: nextItems,
                          updatedAt: new Date().toISOString(),
                        })
                      }
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onOpenJob(job.id)}
                  className="mt-auto grid grid-cols-4 gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-left text-xs hover:bg-slate-100/70 transition-colors"
                >
                  <div>
                    <div className="text-slate-500">Estimate</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900">
                      {formatCurrency(job.estimatedRevenue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Actual Cost</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-700">
                      {formatCurrency(job.actualCost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Margin</div>
                    <div
                      className={`font-mono font-semibold tabular-nums ${
                        margin >= 30 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {margin}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-500">Start</div>
                    <div className="inline-flex items-center justify-end gap-1 font-mono tabular-nums text-slate-700">
                      <Calendar className="h-3 w-3 text-slate-400" />
                      {formatDateShort(job.startDate).replace(', 2026', '')}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Create New Job Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleCreate}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <h2 className="font-display text-lg font-semibold text-slate-900">New Job</h2>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="font-mono text-xs font-semibold text-amber-700">Job ID {nextJobIdLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  resetCreateForm();
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close new job modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">Job Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Master Bath Tile & Vanity Remodel"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as JobStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                >
                  {STATUS_FILTERS.filter((s) => s !== 'All').map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700">Urgency Level</label>
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${getUrgencyMeta(urgency).badgeClass}`}
                  >
                    <span className={`h-2 w-2 rounded-xs ${getUrgencyMeta(urgency).dotClass}`} />
                    {getUrgencyMeta(urgency).shortLabel}
                  </span>
                </div>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(Number(e.target.value) as UrgencyLevel)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                >
                  {URGENCY_LEVELS.map((u) => (
                    <option key={u.level} value={u.level}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs font-semibold text-slate-700">Client Information</span>
                <button
                  type="button"
                  onClick={() =>
                    onOpenContactPicker((c) => {
                      setClientId(c.id);
                      setClientName(c.name);
                      setClientPhone(formatPhoneNumber(c.phone));
                      setClientEmail(c.email);
                      if (c.address) setSiteAddress(c.address);
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-800"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  Select from Contacts
                </button>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">Client Name *</label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Client Phone</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(formatPhoneInput(e.target.value))}
                  placeholder="503-555-0199"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Client Email</label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@email.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">Job Site Address</label>
                <input
                  type="text"
                  value={siteAddress}
                  onChange={(e) => setSiteAddress(e.target.value)}
                  placeholder="Street address, city"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Finish Date</label>
                <input
                  type="date"
                  value={finishDate}
                  onChange={(e) => setFinishDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
                <MaterialsListPanel
                  compact
                  materialsNeeded={materialsNeeded}
                  items={materialsList}
                  onChange={(nextNeeded, nextItems) => {
                    setMaterialsNeeded(nextNeeded);
                    setMaterialsList(nextItems);
                  }}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">Job Notes</label>
                <textarea
                  rows={3}
                  value={jobNotes}
                  onChange={(e) => setJobNotes(e.target.value)}
                  placeholder="Add job notes, gate codes, or client requests..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="sm:col-span-2 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700">Add Photos</label>
                  {(photos.length > 0 || selectedGooglePhotos.length > 0) && (
                    <span className="font-mono text-xs text-slate-500">
                      {photos.length + selectedGooglePhotos.length} photo(s) ready
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-700 transition-colors hover:border-amber-500 hover:bg-amber-50">
                    <Camera className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="truncate">Upload / Take Photos</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      capture="environment"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files || []);
                        if (picked.length > 0) {
                          setPhotos((prev) => [...prev, ...picked]);
                        }
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={!isOnline}
                    onClick={handleOpenGooglePhotosPicker}
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-800 transition-colors hover:border-amber-500 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ImageIcon className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="truncate">
                      {!isOnline
                        ? 'Google Photos (Offline)'
                        : googleConnected
                        ? 'Select from Google Photos'
                        : 'Sign in for Google Photos'}
                    </span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-500">
                  {googleConnected
                    ? isOnline
                      ? 'Uploaded device photos sync to your Google Drive job folder; selected Google Photos link directly.'
                      : 'Offline mode: Uploaded photos cache on this device and auto-upload to Google Drive when signal returns.'
                    : 'Local uploads cache offline immediately. Sign in with Google to select from Google Photos and back up to Drive.'}
                </p>

                {(photos.length > 0 || selectedGooglePhotos.length > 0) && (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 pt-1">
                    {selectedGooglePhotos.map((photo) => (
                      <div
                        key={`gp-${photo.id}`}
                        className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white"
                      >
                        <div className="h-24 bg-slate-100">
                          {photo.thumbnailLink ? (
                            <img
                              src={photo.thumbnailLink}
                              alt={photo.name}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-400">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-slate-800">{photo.name}</div>
                            <div className="text-[10px] font-medium text-emerald-700">Google Photos</div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedGooglePhotos((prev) => prev.filter((p) => p.id !== photo.id))
                            }
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                            aria-label={`Remove ${photo.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {photos.map((file, idx) => (
                      <div
                        key={`local-${file.name}-${idx}`}
                        className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white"
                      >
                        <div className="h-24 bg-slate-100">
                          {localPhotoPreviews[idx] ? (
                            <img
                              src={localPhotoPreviews[idx]}
                              alt={file.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-400">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-slate-800">{file.name}</div>
                            <div className="font-mono text-[10px] text-slate-500">
                              {formatBytes(file.size)} · {googleConnected ? 'Drive Upload' : 'Local'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                            aria-label={`Remove ${file.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  resetCreateForm();
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {submitting ? 'Creating...' : 'Create Job'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Google Photos Multi-Select Picker Modal (from New Job) */}
      {showGooglePhotosPicker && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Select from Google Photos
                </h2>
                <p className="text-xs text-slate-500">
                  Tap photos to attach them to Job ID {nextJobIdLabel}. Selected: {selectedGooglePhotos.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGooglePhotosPicker(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close Google Photos picker"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-100 px-6 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={photoSearch}
                  onChange={(e) => setPhotoSearch(e.target.value)}
                  placeholder="Filter Google Photos by file name..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-amber-600 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingGooglePhotos ? (
                <div className="py-12 text-center text-sm text-slate-500">Loading your Google Photos library...</div>
              ) : googlePhotosError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
                  {googlePhotosError}
                </div>
              ) : googlePhotosLibrary.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  No photos found in your Google Drive / Photos library yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {googlePhotosLibrary
                    .filter((p) =>
                      photoSearch.trim() ? p.name.toLowerCase().includes(photoSearch.trim().toLowerCase()) : true
                    )
                    .map((photo) => {
                      const isSelected = selectedGooglePhotos.some((p) => p.id === photo.id);
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => toggleGooglePhotoSelection(photo)}
                          className={`overflow-hidden rounded-lg border text-left transition-all ${
                            isSelected
                              ? 'border-amber-600 ring-2 ring-amber-600/30 bg-amber-50/40'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="relative h-32 bg-slate-100">
                            {photo.thumbnailLink ? (
                              <img
                                src={photo.thumbnailLink}
                                alt={photo.name}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-slate-400">
                                <ImageIcon className="h-6 w-6" />
                              </div>
                            )}
                            {isSelected && (
                              <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-amber-600 text-white shadow">
                                <Check className="h-3.5 w-3.5" />
                              </div>
                            )}
                          </div>
                          <div className="p-2.5">
                            <div className="truncate text-xs font-medium text-slate-900">{photo.name}</div>
                            <div className="mt-0.5 text-[11px] font-medium text-slate-500">
                              {isSelected ? 'Selected for job' : 'Click to select'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <span className="text-xs text-slate-600">
                {selectedGooglePhotos.length} Google Photo(s) selected
              </span>
              <button
                type="button"
                onClick={() => setShowGooglePhotosPicker(false)}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap"
              >
                Done ({selectedGooglePhotos.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
