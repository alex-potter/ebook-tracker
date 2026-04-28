'use client';

import { useEffect, useState } from 'react';
import { installPrompt, type InstallState } from '@/lib/pwa/install-prompt';

export default function InstallButton() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<InstallState>('idle');

  useEffect(() => {
    setMounted(true);
    return installPrompt.subscribe(setState);
  }, []);

  if (!mounted) return null;
  if (installPrompt.isStandalone()) return null;
  if (installPrompt.platform() === 'unsupported') return null;
  if (state === 'installed') return null;

  return (
    <button
      type="button"
      onClick={() => installPrompt.maybeShow('settings')}
      className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-ink hover:bg-paper-dark"
    >
      <span>Install as app</span>
      <span aria-hidden="true" className="text-ink-dim">›</span>
    </button>
  );
}
