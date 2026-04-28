'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { installPrompt, type InstallState } from '@/lib/pwa/install-prompt';

export default function InstallBanner() {
  const [state, setState] = useState<InstallState>('idle');

  useEffect(() => installPrompt.subscribe(setState), []);

  const visible = state === 'available' || state === 'ios-instructions';

  async function handleInstall() {
    const outcome = await installPrompt.requestInstall();
    if (outcome === 'no-prompt') {
      installPrompt.hide();
    }
  }

  function handleNotNow() {
    installPrompt.hide();
  }

  function handleGotIt() {
    installPrompt.dismiss();
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          role="dialog"
          aria-label="Install BookBuddy"
          className="fixed bottom-20 left-3 right-3 z-40 mx-auto max-w-md rounded-2xl border border-border bg-paper-raised p-4 shadow-lg"
        >
          {state === 'available' ? (
            <>
              <p className="mb-3 text-sm text-ink">
                Install BookBuddy — keep your books and reading state on this device.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleInstall}
                  className="flex-1 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90"
                >
                  Install
                </button>
                <button
                  onClick={handleNotNow}
                  className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-dim hover:text-ink"
                >
                  Not now
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink">
                To install BookBuddy: tap{' '}
                <span aria-hidden="true" className="inline-block align-middle">
                  <svg width="16" height="20" viewBox="0 0 16 20" fill="none" className="inline">
                    <path
                      d="M8 13V2M8 2L4 6M8 2l4 4M2 12v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>{' '}
                in Safari, then choose <strong>Add to Home Screen</strong>.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={handleGotIt}
                  className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90"
                >
                  Got it
                </button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
