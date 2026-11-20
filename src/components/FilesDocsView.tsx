import React, { useEffect, useState } from 'react';
import {
  Camera,
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { formatBytes, formatDateShort, isSafeHttpUrl } from '../lib/formatters';
import { getOfflineBlob } from '../lib/offlineDb';
import type { GooglePhotoItem, JobFile, JobOrder } from '../types';

interface FilesDocsViewProps {
  jobs: JobOrder[];
  files: JobFile[];
  googleConnected: boolean;
  isOnline: boolean;
  onUploadFiles: (jobId: string, category: JobFile['category'], uploadedFiles: File[]) => Promise<void>;
  onDeleteFile: (file: JobFile) => Promise<void>;
  onBrowseGooglePhotos: () => Promise<GooglePhotoItem[]>;
  onLinkGooglePhotoToJob: (jobId: string, photo: GooglePhotoItem) => Promise<void>;
}

const CATEGORIES: Array<'All' | JobFile['category']> = [
  'All',
  'Site Photo',
  'Estimate & Contract',
  'Permit',
  'Blueprint / Plan',
  'Receipt',
];

export const FilesDocsView: React.FC<FilesDocsViewProps> = ({
  jobs,
  files,
  googleConnected,
  isOnline,
  onUploadFiles,
  onDeleteFile,
  onBrowseGooglePhotos,
  onLinkGooglePhotoToJob,
}) => {
  const [selectedJobId, setSelectedJobId] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<'All' | JobFile['category']>('All');
  const [search, setSearch] = useState('');
  const [uploadJobId, setUploadJobId] = useState(jobs[0]?.id || '');
  const [uploadCategory, setUploadCategory] = useState<JobFile['category']>('Site Photo');
  const [uploading, setUploading] = useState(false);

  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [previewFile, setPreviewFile] = useState<{ file: JobFile; src?: string } | null>(null);

  const [showPhotosModal, setShowPhotosModal] = useState(false);
  const [googlePhotos, setGooglePhotos] = useState<GooglePhotoItem[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const toRevoke: string[] = [];
    async function hydrateBlobs() {
      const next: Record<string, string> = {};
      for (const f of files) {
        if (f.localUrl) {
          next[f.id] = f.localUrl;
        } else if (f.hasOfflineBlob) {
          const blob = await getOfflineBlob(f.id);
          if (blob && active) {
            const url = URL.createObjectURL(blob);
            toRevoke.push(url);
            next[f.id] = url;
          }
        }
      }
      if (active) setBlobUrls(next);
    }
    hydrateBlobs();
    return () => {
      active = false;
      for (const u of toRevoke) URL.revokeObjectURL(u);
    };
  }, [files]);

  const filtered = files
    .filter((f) => (selectedJobId === 'all' ? true : f.jobId === selectedJobId))
    .filter((f) => (categoryFilter === 'All' ? true : f.category === categoryFilter))
    .filter((f) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || (f.notes || '').toLowerCase().includes(q);
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  const handleFileInput = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !uploadJobId) return;
    setUploading(true);
    try {
      await onUploadFiles(uploadJobId, uploadCategory, Array.from(fileList));
    } finally {
      setUploading(false);
    }
  };

  const handleOpenPhotosBrowser = async () => {
    setShowPhotosModal(true);
    setLoadingPhotos(true);
    setPhotosError(null);
    try {
      const items = await onBrowseGooglePhotos();
      setGooglePhotos(items);
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : 'Unable to load Google Photos library.');
    } finally {
      setLoadingPhotos(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Files, Docs &amp; Site Photos
          </h1>
          <p className="text-sm text-slate-600">
            High-capacity Google Drive &amp; Photos storage with offline local caching for remote job sites.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {googleConnected && isOnline && (
            <button
              type="button"
              onClick={handleOpenPhotosBrowser}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <ImageIcon className="h-3.5 w-3.5 text-amber-600" />
              Import from Google Photos
            </button>
          )}
        </div>
      </div>

      {/* Upload Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-4">
            <label className="block text-xs font-medium text-slate-700">Target Job Order Folder</label>
            <select
              value={uploadJobId}
              onChange={(e) => setUploadJobId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.jobNumber} — {j.title}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-medium text-slate-700">Document / Media Type</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as JobFile['category'])}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            >
              {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2 lg:col-span-5">
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 whitespace-nowrap">
              <Camera className="h-4 w-4" />
              {uploading ? 'Saving...' : 'Capture / Upload Photos'}
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                disabled={uploading}
                onChange={(e) => handleFileInput(e.target.files)}
                className="hidden"
              />
            </label>
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap">
              <Upload className="h-4 w-4 text-slate-600" />
              Upload PDF / Docs
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xlsx,.csv,.txt,image/*"
                multiple
                disabled={uploading}
                onChange={(e) => handleFileInput(e.target.files)}
                className="hidden"
              />
            </label>
          </div>
        </div>
        <p className="mt-2.5 text-xs text-slate-500">
          {googleConnected
            ? isOnline
              ? 'Files save locally for instant offline access and upload to your "FieldLedger Job Files & Photos" Google Drive folder.'
              : 'Offline mode: Files are saved safely on this device and queued for automatic Google Drive upload when signal returns.'
            : 'Files save locally in high-capacity device storage. Sign in with Google to back up automatically to Google Drive.'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            aria-label="Filter files by job order"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="all">All Job Folders ({files.length})</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.jobNumber} — {j.title}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  categoryFilter === c ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files & notes..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      {/* File Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm font-medium text-slate-700">No files or photos in this view</p>
          <p className="mt-1 text-xs text-slate-500">
            Capture site photos or upload permits and contracts above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((f) => {
            const job = jobs.find((j) => j.id === f.jobId);
            const isImage = f.mimeType.startsWith('image/');
            const src = blobUrls[f.id] || f.localUrl || f.googlePhotosUrl;

            return (
              <div key={f.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
                {isImage ? (
                  <button
                    type="button"
                    onClick={() => setPreviewFile({ file: f, src })}
                    className="relative h-44 w-full bg-slate-100 overflow-hidden text-left"
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={f.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                  </button>
                ) : (
                  <div className="flex h-44 items-center justify-center bg-slate-50 border-b border-slate-100">
                    <div className="text-center px-4">
                      <FileText className="mx-auto h-9 w-9 text-slate-400" />
                      <div className="mt-2 font-mono text-xs text-slate-500">
                        {f.mimeType.split('/')[1]?.toUpperCase() || 'DOCUMENT'}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="truncate">{f.category}</span>
                    <span
                      className={`font-medium shrink-0 ${
                        f.syncState === 'synced'
                          ? 'text-emerald-700'
                          : f.syncState === 'pending'
                          ? 'text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {f.syncState === 'synced'
                        ? 'Google Drive'
                        : f.syncState === 'pending'
                        ? 'Queued Upload'
                        : 'Cached Offline'}
                    </span>
                  </div>

                  <h3 className="mt-1 font-medium text-sm text-slate-900 truncate" title={f.name}>
                    {f.name}
                  </h3>
                  <div className="mt-0.5 text-xs text-slate-500 truncate">
                    {job ? `${job.jobNumber} · ${job.title}` : 'General'}
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 mt-3 text-xs text-slate-500">
                    <span className="font-mono tabular-nums">
                      {formatBytes(f.sizeBytes)} · {formatDateShort(f.uploadedAt)}
                    </span>
                    <div className="flex items-center gap-1">
                      {f.driveWebViewLink && isSafeHttpUrl(f.driveWebViewLink) && (
                        <a
                          href={f.driveWebViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          aria-label={`Open ${f.name} in Google Drive`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteFile(f)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${f.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image Preview Lightbox */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <div className="font-medium text-sm text-slate-900">{previewFile.file.name}</div>
                <div className="text-xs text-slate-500">
                  {previewFile.file.category} · {formatBytes(previewFile.file.sizeBytes)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close photo preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="bg-slate-950 flex items-center justify-center max-h-[76vh]">
              {previewFile.src ? (
                <img
                  src={previewFile.src}
                  alt={previewFile.file.name}
                  referrerPolicy="no-referrer"
                  className="max-h-[76vh] w-auto object-contain"
                />
              ) : (
                <div className="p-16 text-sm text-slate-400">Preview unavailable</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Google Photos / Drive Library Picker Modal */}
      {showPhotosModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Google Photos &amp; Drive Image Library
                </h2>
                <p className="text-xs text-slate-500">
                  Link high-resolution photos from your Google account directly to{' '}
                  {jobs.find((j) => j.id === uploadJobId)?.jobNumber || 'selected job'}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPhotosModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close Google Photos picker"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingPhotos ? (
                <div className="py-12 text-center text-sm text-slate-500">Loading your Google photos...</div>
              ) : photosError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
                  {photosError}
                </div>
              ) : googlePhotos.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  No photos found in your Google Drive / Photos library yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {googlePhotos.map((photo) => (
                    <div key={photo.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <div className="h-32 bg-slate-100">
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
                      </div>
                      <div className="p-2.5">
                        <div className="truncate text-xs font-medium text-slate-900">{photo.name}</div>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!uploadJobId) return;
                            await onLinkGooglePhotoToJob(uploadJobId, photo);
                            setShowPhotosModal(false);
                          }}
                          className="mt-2 w-full rounded bg-amber-600 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                        >
                          Attach to Job
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
