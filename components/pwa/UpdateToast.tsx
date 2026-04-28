'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Workbox } from 'workbox-window';

let externalShow: ((wb: Workbox) => void) | null = null;

function Mount() {
  const [wb, setWb] = useState<Workbox | null>(null);

  useEffect(() => {
    externalShow = setWb;
    return () => {
      externalShow = null;
    };
  }, []);

  function refresh() {
    if (!wb) return;
    wb.addEventListener('controlling', () => {
      window.location.reload();
    });
    wb.messageSkipWaiting();
  }

  function later() {
    setWb(null);
  }

  return (
    <AnimatePresence>
      {wb && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-2xl border border-border bg-paper-raised px-4 py-3 shadow-lg sm:left-auto sm:right-4 sm:translate-x-0"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink">A new version of BookBuddy is ready.</span>
            <button
              onClick={refresh}
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90"
            >
              Refresh
            </button>
            <button
              onClick={later}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-ink-dim hover:text-ink"
            >
              Later
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const UpdateToast = {
  Mount,
  show: (wb: Workbox) => {
    externalShow?.(wb);
  },
};

export default UpdateToast;
