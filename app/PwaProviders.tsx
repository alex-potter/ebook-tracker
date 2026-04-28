'use client';

import { useEffect } from 'react';
import { installPrompt } from '@/lib/pwa/install-prompt';

export default function PwaProviders() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NEXT_PUBLIC_CAPACITOR === 'true') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;
    installPrompt.attach();

    (async () => {
      const { Workbox } = await import('workbox-window');
      if (cancelled) return;

      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const wb = new Workbox(`${basePath}/sw.js`, { scope: `${basePath}/` });

      wb.register().catch((err) => {
        console.error('[PWA] SW registration failed:', err);
      });
    })();

    return () => {
      cancelled = true;
      installPrompt.detach();
    };
  }, []);

  return null;
}
