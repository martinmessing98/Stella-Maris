import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
      >
        <Download className="h-3.5 w-3.5 text-amber-400" />
        Install Field App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5 text-amber-400" />
          Install on iPhone
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Install FieldLedger on iOS
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                1. Tap the <strong>Share</strong> icon in Safari.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong> for full offline job-site access.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
