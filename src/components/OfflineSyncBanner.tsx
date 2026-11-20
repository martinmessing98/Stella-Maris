import React from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

interface OfflineSyncBannerProps {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  onSyncNow: () => void;
}

export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = ({
  isOnline,
  pendingCount,
  isSyncing,
  onSyncNow,
}) => {
  if (isOnline && pendingCount === 0) {
    return null;
  }

  return (
    <div
      className={`border-b px-4 py-2 text-xs font-medium flex flex-wrap items-center justify-between gap-3 ${
        !isOnline
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-slate-200 bg-slate-100 text-slate-800'
      }`}
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="h-3.5 w-3.5 text-amber-700 shrink-0" />
            <span>
              Offline Field Mode active — all job logs, photos, schedules, and payments save locally to this device.
            </span>
          </>
        ) : (
          <span>
            Connection restored — <span className="font-mono font-semibold tabular-nums">{pendingCount}</span> offline item(s) waiting to sync.
          </span>
        )}
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center gap-3 shrink-0">
          {!isOnline && (
            <span className="font-mono tabular-nums text-amber-800">
              {pendingCount} queued
            </span>
          )}
          {isOnline && (
            <button
              type="button"
              onClick={onSyncNow}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Queue'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
