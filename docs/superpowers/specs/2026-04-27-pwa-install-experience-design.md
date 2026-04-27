# PWA Install Experience Design

**Date:** 2026-04-27
**Status:** Draft

## Problem

BookBuddy has a minimal PWA setup today: a hand-written 30-line network-first service worker, a `manifest.json` with maskable icons, and a runtime canvas trick that paints an iOS splash on first load. The basics work, but the install experience is friction-heavy:

- No install prompt UI — users must discover the browser's "Install app" menu themselves
- iOS users get nothing; the canvas splash trick is a workaround for missing real splash assets
- Asset generation is manual and has drifted (both `icon.svg` and `logo.svg` show as modified)
- Service worker is network-first with no precache, so first offline load is broken
- No update flow — users on stale builds don't know a new version exists

The install banner, when added, must respect the funnel reality: iOS users won't enter API keys in a browser before installing, so the trigger has to fire **before** any heavy commitment, anchored to the library-browsing flow.

## Scope

In scope:
- Replace hand-written service worker with `@ducanh2912/next-pwa` (Workbox-based)
- Add intent-based install banner triggered when a user taps a book in the library, with iOS instructions variant
- Add Settings entry as a permanent install fallback
- Add update toast when a new SW version is waiting
- Single-source icon pipeline via `pwa-asset-generator` driven by `public/icon.svg`
- Generate real iOS splash screens; remove the runtime canvas trick
- Pre-commit hook (Husky + lint-staged) regenerates assets when `icon.svg` changes; CI verifies no drift
- Strip all PWA machinery from the Capacitor APK build

Out of scope:
- Caching downloaded EPUB blobs (already parsed into IndexedDB on import; re-caching the source file is redundant)
- Push notifications, background sync, or other Workbox features beyond precache + runtime caching
- Per-user install analytics

## Design

### Architecture overview

**Dependencies added:**

| Package | Type | Purpose |
|---|---|---|
| `@ducanh2912/next-pwa` | dep | Workbox-based SW generator for Next.js 14 |
| `workbox-window` | dep | Runtime helper for SW lifecycle events |
| `pwa-asset-generator` | devDep | One-shot icon + splash generator |
| `husky` | devDep | Git-hook installer |
| `lint-staged` | devDep | Run commands against staged files only |

**File map:**

| Path | Action | Purpose |
|---|---|---|
| `next.config.js` | modify | Wrap with `withPWA(...)`, gated off when `NEXT_PUBLIC_MOBILE === 'true'` |
| `public/sw.js` | delete | Replaced by Workbox-generated SW |
| `public/manifest.json` | regenerate | Rewritten by `pwa-asset-generator` |
| `public/icon.svg` | keep | Source of truth for the app icon |
| `public/logo.svg` | keep | Separate in-app branding asset, untouched by pipeline |
| `public/icons/` | new dir | Generated app icons + iOS splashes |
| `public/favicon.ico`, `apple-icon-180.png`, `manifest-icon-*.png`, `favicon-196.png` | delete | Moved into `public/icons/` as regenerated outputs |
| `app/layout.tsx` | modify | Drop inline SW registration, drop canvas splash trick, add real splash `<link>` tags, conditionally include `<PwaProviders />` |
| `app/PwaProviders.tsx` | new | Client component: registers SW via `workbox-window`, mounts banner + toast |
| `lib/pwa/install-prompt.ts` | new | Singleton: captures `beforeinstallprompt`, exposes API, persists dismissal |
| `components/pwa/InstallBanner.tsx` | new | Intent-based banner (Android/desktop variant + iOS instructions variant) |
| `components/pwa/UpdateToast.tsx` | new | Listens to `workbox-window` `'waiting'` event |
| `components/pwa/InstallButton.tsx` | new | Settings entry for users who dismissed the banner |
| `components/SettingsModal.tsx` | modify | Add `<InstallButton />` row |
| `components/GithubLibrary.tsx` | modify | Call `installPrompt.maybeShow('book-tap')` in `handleSelect` |
| `components/CalibreLibrary.tsx` | modify | Same call at the equivalent point |
| `scripts/mobile-build.js` | modify | Stash/restore SW + manifest files alongside existing `app/api/` stash |
| `scripts/generate-pwa-assets.js` | new | Wraps `pwa-asset-generator` with our exact flags |
| `package.json` | modify | Add `pwa:assets`, `pwa:assets:check`, `prepare` scripts; add `lint-staged` config |
| `.husky/pre-commit` | new | Runs `npx lint-staged` |

**Three deploy modes after change:**

| Mode | SW | Manifest | Install banner |
|---|---|---|---|
| `npm run dev` / `npm run build` (web/server) | Yes (Workbox) | Yes | Active when not standalone |
| `npm run deploy:gh-pages` | Yes, scoped to `/bookbuddy/` | Yes | Active |
| `npm run cap:android` | No (stripped) | No | Inert (component never mounted) |

### Service worker (Workbox config)

`next.config.js`:

```js
const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NEXT_PUBLIC_MOBILE === 'true' || process.env.NODE_ENV === 'development',
  register: false,
  scope: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/',
  workboxOptions: {
    cleanupOutdatedCaches: true,
    skipWaiting: false,
    clientsClaim: false,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/api\.github\.com\/repos\/.+\/git\/trees\/.+/,
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'gh-library-catalog', expiration: { maxEntries: 8, maxAgeSeconds: 86400 } },
      },
      {
        urlPattern: /^https:\/\/raw\.githubusercontent\.com\/.+/,
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'gh-library-assets', expiration: { maxEntries: 50, maxAgeSeconds: 604800 } },
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.+/,
        handler: 'CacheFirst',
        options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
      },
    ],
  },
});

const isMobile = process.env.NEXT_PUBLIC_MOBILE === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  ...(isMobile ? { output: 'export', trailingSlash: true } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: { unoptimized: isMobile },
};

module.exports = withPWA(nextConfig);
```

**Behavior:**

- **App shell precache:** next-pwa walks the Next build manifest and precaches every static asset with revision hashes.
- **Navigation handler:** defaults to network-first for HTML, falls back to cached shell offline.
- **Anthropic API calls:** not matched by any rule → pass through. SW never sees user API keys.
- **Same-origin uncached requests:** pass through. We do not blanket-cache (that was the foot-gun of the old `sw.js`).
- **`skipWaiting: false` + `clientsClaim: false`:** new SW waits in `installed` state until the user clicks Refresh in the update toast. Required for the toast to be meaningful.

`app/PwaProviders.tsx` sketch:

```tsx
'use client';
import { useEffect } from 'react';
import { Workbox } from 'workbox-window';
import UpdateToast from '@/components/pwa/UpdateToast';
import InstallBanner from '@/components/pwa/InstallBanner';
import { installPrompt } from '@/lib/pwa/install-prompt';

export default function PwaProviders() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NEXT_PUBLIC_MOBILE === 'true') return;

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const wb = new Workbox(`${basePath}/sw.js`, { scope: `${basePath}/` });

    wb.addEventListener('waiting', () => UpdateToast.show(wb));
    wb.register();

    installPrompt.attach();
    return () => installPrompt.detach();
  }, []);

  return (
    <>
      <UpdateToast.Mount />
      <InstallBanner />
    </>
  );
}
```

### Install prompt

**Singleton — `lib/pwa/install-prompt.ts`**

Captures `beforeinstallprompt` before any UI renders, exposes typed API, persists dismissal in localStorage.

```ts
type Platform = 'android' | 'ios' | 'desktop' | 'unsupported';
type InstallState = 'idle' | 'available' | 'ios-instructions' | 'installed' | 'dismissed';

const DISMISS_KEY = 'bb.pwa.installDismissed';   // 'true' once dismissed, never re-asked
const SHOWN_KEY   = 'bb.pwa.installShownAt';     // timestamp; suppress re-show within 7d
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(s: InstallState) => void>();

export const installPrompt = {
  attach() { /* window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; }); 'appinstalled' → state='installed' */ },
  detach() { /* remove listeners */ },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  platform(): Platform {
    // iOS Safari → 'ios'; deferred captured → 'android'/'desktop' (UA-distinguished); else 'unsupported'
  },
  isStandalone(): boolean {
    // matchMedia '(display-mode: standalone)' || (navigator as any).standalone
  },
  isDismissed(): boolean { return localStorage.getItem(DISMISS_KEY) === 'true'; },

  maybeShow(reason: 'book-tap' | 'settings') {
    if (this.isStandalone()) return;
    if (reason === 'book-tap' && this.isDismissed()) return;
    if (reason === 'book-tap' && recentlyShown()) return;
    const p = this.platform();
    if (p === 'unsupported') return;
    emit(p === 'ios' ? 'ios-instructions' : 'available');
    if (reason === 'book-tap') localStorage.setItem(SHOWN_KEY, String(Date.now()));
  },

  async requestInstall(): Promise<'accepted' | 'dismissed' | 'no-prompt'> {
    if (!deferred) return 'no-prompt';
    await deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    return choice.outcome;
  },

  dismiss() { localStorage.setItem(DISMISS_KEY, 'true'); emit('dismissed'); },
};
```

**Banner — `components/pwa/InstallBanner.tsx`**

Non-modal slide-up sheet anchored to bottom of viewport (above existing `BottomNav`), styled with framer-motion (already a dep). Two variants by state:

- **`available` (Android/desktop):** *"Install BookBuddy — keep your books and reading state on this device."* with **Install** (calls `requestInstall()`) and **Not now** buttons. On `accepted` → state goes `installed`. **Not now** dismisses for the session but does NOT set `DISMISS_KEY` (user might still want it via Settings later).
- **`ios-instructions` (iOS Safari):** *"To install: tap the Share icon, then 'Add to Home Screen.'"* with iOS share-icon glyph rendered as inline SVG. Only a **Got it** button (no programmatic install on iOS). Tapping it sets `DISMISS_KEY`.

The banner mounts inside `PwaProviders` and subscribes to the singleton's state. Renders only when state is `available` or `ios-instructions`.

**Trigger wiring**

In `components/GithubLibrary.tsx`, inside `handleSelect`:

```ts
async function handleSelect(entry) {
  setDownloading(entry.path);
  installPrompt.maybeShow('book-tap');   // fire-and-forget; non-blocking
  // ...existing download+import logic
}
```

Same one-line addition in `components/CalibreLibrary.tsx`. Banner appears alongside download progress, not blocking.

**Settings entry — `components/pwa/InstallButton.tsx`**

Lives in `SettingsModal`. Renders nothing if `isStandalone()` or platform is `unsupported`. Otherwise a row labeled **"Install as app"** with chevron. Tap → `installPrompt.maybeShow('settings')` which **bypasses** dismissal flag (user explicitly came to Settings).

**Flag interactions:**

- `DISMISS_KEY` only blocks the auto-trigger from `book-tap`. Settings always works.
- `SHOWN_KEY` (7d cooldown) is a safety so a user who taps multiple books in one session isn't re-banner'd; tapping **Not now** ≠ tapping **Dismiss**.
- `appinstalled` event clears both flags and locks state to `installed` for the session.

### Update toast

**Behavior**

When `next-pwa` ships a new SW:

1. New SW downloads in background, enters `installed` state but stays waiting (because `skipWaiting: false`).
2. `workbox-window` fires `'waiting'` → `PwaProviders` calls `UpdateToast.show(wb)`.
3. Toast slides in (top-right desktop / top-center mobile): *"A new version of BookBuddy is ready."* with **Refresh** and **Later** buttons.
4. **Refresh** → `wb.messageSkipWaiting()` then `wb.addEventListener('controlling', () => window.location.reload())`.
5. **Later** → toast dismisses; next full page load picks up the waiting SW naturally.

**Component sketch — `components/pwa/UpdateToast.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { Workbox } from 'workbox-window';

let externalShow: ((wb: Workbox) => void) | null = null;

function Mount() {
  const [wb, setWb] = useState<Workbox | null>(null);
  useEffect(() => { externalShow = setWb; return () => { externalShow = null; }; }, []);
  if (!wb) return null;

  const refresh = () => {
    wb.addEventListener('controlling', () => window.location.reload());
    wb.messageSkipWaiting();
  };

  return (
    <div role="status" aria-live="polite" className="...toast styling...">
      <span>A new version of BookBuddy is ready.</span>
      <button onClick={refresh}>Refresh</button>
      <button onClick={() => setWb(null)}>Later</button>
    </div>
  );
}

const UpdateToast = {
  Mount,
  show: (wb: Workbox) => externalShow?.(wb),
};
export default UpdateToast;
```

**Edge cases handled**

- **No waiting SW on first install** — `'waiting'` only fires when there's an existing controller being replaced. First-time installs activate immediately and never show the toast. Correct.
- **Multiple tabs open** — `messageSkipWaiting` activates the new SW for all clients. Each tab's `'controlling'` listener fires and reloads its own tab.
- **User clicks Refresh mid-AI-call** — page reload kills the in-flight call. Acceptable: user-initiated. Last-saved snapshot is preserved in IndexedDB.
- **`'waiting'` fires while toast already showing** — second event is no-op since `wb` is already set.

### Asset pipeline

Single source: `public/icon.svg`. Outputs everything else.

`scripts/generate-pwa-assets.js`:

```js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'icon.svg');
const OUT = path.join(__dirname, '..', 'public', 'icons');
const MANIFEST = path.join(__dirname, '..', 'public', 'manifest.json');

if (!fs.existsSync(SRC)) { console.error('Missing public/icon.svg'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const cmd = [
  'npx pwa-asset-generator',
  `"${SRC}"`,
  `"${OUT}"`,
  `--manifest "${MANIFEST}"`,
  '--index public/_pwa-meta.html',
  '--icon-only false',
  '--favicon',
  '--mstile',
  '--padding "10%"',
  '--background "#09090b"',
  '--opaque true',
  '--type png',
  '--quality 90',
  '--path "/icons"',
  '--path-override "/icons"',
].join(' ');

execSync(cmd, { stdio: 'inherit' });
console.log('PWA assets regenerated. Review public/_pwa-meta.html and copy any new <link> tags into app/layout.tsx if needed.');
```

`package.json` additions:

```json
"scripts": {
  "prepare": "husky",
  "pwa:assets": "node scripts/generate-pwa-assets.js",
  "pwa:assets:check": "node scripts/generate-pwa-assets.js && git diff --exit-code public/icons public/manifest.json"
},
"lint-staged": {
  "public/icon.svg": [
    "node scripts/generate-pwa-assets.js",
    "git add public/icons public/manifest.json"
  ]
}
```

**Generated under `public/icons/`:**

- App icons: `manifest-icon-192.maskable.png`, `manifest-icon-512.maskable.png`, plus `any`-purpose variants
- Apple touch icons: `apple-icon-180.png` (and 152, 167)
- Favicons: `favicon-196.png`, `favicon-32.png`, `favicon-16.png`, `favicon.ico`
- iOS splash screens: ~20 PNGs covering iPhone SE through iPad Pro, both orientations
- Microsoft tile: `mstile-150x150.png`

**Manifest after regeneration** (icons array overwritten in place; other fields preserved):

```json
{
  "name": "BookBuddy",
  "short_name": "BookBuddy",
  "description": "Track characters as you read your ebook — spoiler-free",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#09090b",
  "theme_color": "#09090b",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/icons/manifest-icon-192.maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/manifest-icon-512.maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-192.png",                   "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png",                   "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```

**`layout.tsx` changes:**

- Delete inline SW registration (lines 49-53) — moved to `PwaProviders`
- Delete canvas splash trick (lines 54-58) — replaced by real splash PNGs via `<link rel="apple-touch-startup-image">` tags
- Apple splash `<link>` tags (~20 of them) copied once from `_pwa-meta.html` into `<head>`. Static — only need re-copying if Apple adds a new device size.
- `metadata.icons.apple` updates to `/icons/apple-icon-180.png`
- `metadata.icons.icon` updates favicon paths to `/icons/...`

**When the script runs:**

- Manually before first PR (one-time seed)
- Automatically on commit when `icon.svg` is staged (via lint-staged)
- Verified in CI via `pwa:assets:check`
- **Not** part of `next build` — keeps `pwa-asset-generator`'s Puppeteer dependency out of normal builds

### Pre-commit hook + CI verification

**`.husky/pre-commit`:**

```sh
npx lint-staged
```

A single line. lint-staged checks staged diff; if `public/icon.svg` isn't there, asset script doesn't run. Other staged changes pass through untouched. `prepare` is npm's lifecycle hook — `npm install` runs it once and Husky installs the git hooks.

**CI step** (added to whatever workflow runs on PR; create one if none exists):

```yaml
- run: npm ci
- run: npm run pwa:assets:check
```

If a contributor bypasses the hook (`git commit --no-verify`) or edits `icon.svg` outside a normal commit flow, CI catches drift: script regenerates, then `git diff --exit-code` returns non-zero if any output file changed.

**Protects against:**

- Forgotten regeneration (pre-commit catches locally; CI catches if local was bypassed)
- Manifest drift (icons array gets overwritten on regen; CI surfaces drift instead of silently overwriting)
- Wrong source file (editing `logo.svg` thinking it's the app icon — nothing fires, which is correct)

**Does not protect against:**

- Renaming `icon.svg` — lint-staged matches by path, so a rename breaks the trigger. Acceptable; renaming the source file is a deliberate refactor.

### Capacitor build hardening

**`next.config.js` already gates SW generation** — `disable: process.env.NEXT_PUBLIC_MOBILE === 'true'` means `next-pwa` doesn't emit `sw.js` during the mobile build.

**`scripts/mobile-build.js` additions:**

```js
const PWA_FILES_TO_STASH = [
  'public/sw.js',
  'public/sw.js.map',
  'public/manifest.json',
  'public/_pwa-meta.html',
  // plus glob for public/workbox-*.js
];

stash(PWA_FILES_TO_STASH);
try {
  process.env.NEXT_PUBLIC_MOBILE = 'true';
  execSync('next build', { stdio: 'inherit' });
} finally {
  restore(PWA_FILES_TO_STASH);
  restore(['app/api']);
}
```

The manifest stripping is belt-and-suspenders: with `next-pwa` disabled the SW won't register, but a leftover `<link rel="manifest">` could still trigger Capacitor's WebView to surface an install prompt for a "different" app. Removing the reference at runtime is cleaner than relying on Android to ignore it.

**`app/layout.tsx` — conditional manifest and `<PwaProviders>`:**

```tsx
export const metadata: Metadata = {
  title: 'BookBuddy',
  description: '...',
  ...(process.env.NEXT_PUBLIC_MOBILE === 'true' ? {} : { manifest: '/manifest.json' }),
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'BookBuddy' },
  icons: { /* same paths */ },
};

export default function RootLayout({ children }) {
  const isMobile = process.env.NEXT_PUBLIC_MOBILE === 'true';
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        {!isMobile && <PwaProviders />}
      </body>
    </html>
  );
}
```

`NEXT_PUBLIC_MOBILE` is statically evaluated at build time, so `<PwaProviders />` is dead-code-eliminated from the APK bundle entirely.

**Install banner — already inert in Capacitor**

`InstallBanner` mounts inside `PwaProviders`, which doesn't render in mobile builds. The `installPrompt.maybeShow('book-tap')` calls in library components still fire, but `attach()` was never called, `deferred` is null, `platform()` returns `unsupported`, and the call is a no-op. No special-casing needed in library components.

## Cutover order

Single PR; the changes are coherent. Order within the PR matters for verification:

### Step 1 — asset pipeline (no behavior change yet)

- Add `pwa-asset-generator` to devDeps
- Create `scripts/generate-pwa-assets.js`
- Run it once: regenerate `public/icons/`, rewrite `public/manifest.json`
- Update `app/layout.tsx` `metadata.icons` paths to `/icons/...`
- Delete old root-level icon PNGs (`favicon-196.png`, `apple-icon-180.png`, `manifest-icon-192.maskable.png`, `manifest-icon-512.maskable.png`, `favicon.ico`)
- Add `<link rel="apple-touch-startup-image">` tags to `<head>` (copied once from `_pwa-meta.html`)
- Delete the inline canvas splash trick (lines 54-58 of `layout.tsx`)
- Add `pwa:assets` script to `package.json`

**Verifies:** existing site still works, icons resolve, iOS opens with real splashes.

### Step 2 — pre-commit hook

- Add `husky` + `lint-staged` to devDeps
- Add `prepare`, `pwa:assets:check` scripts
- Add lint-staged config
- Create `.husky/pre-commit`
- Add CI step (or document one if no workflow exists)

**Verifies:** edit `icon.svg` locally → commit → assets regenerate and stage automatically. `git commit --no-verify && CI` should fail with diff.

### Step 3 — service worker via next-pwa

- Add `@ducanh2912/next-pwa` and `workbox-window` to deps
- Update `next.config.js` to wrap with `withPWA` and runtime caching rules
- Delete `public/sw.js` (the hand-written one)
- Delete inline SW registration script in `layout.tsx` (lines 49-53)
- Create `app/PwaProviders.tsx` with SW registration only (no UI yet)
- Mount `<PwaProviders />` in `RootLayout`, gated on `!isMobile`

**Verifies:** `npm run build && npm run start`, DevTools → Application shows precached app shell. Reload offline → app shell loads. Library catalog cached after first fetch.

### Step 4 — install singleton + banner + Settings entry

- Create `lib/pwa/install-prompt.ts`
- Create `components/pwa/InstallBanner.tsx`
- Wire `installPrompt.attach()` and `<InstallBanner />` mount into `PwaProviders`
- Add `installPrompt.maybeShow('book-tap')` calls in `GithubLibrary` and `CalibreLibrary`
- Create `components/pwa/InstallButton.tsx`, add it to `SettingsModal`

**Verifies:** Chrome → Lighthouse install prompt available. Tapping a library book triggers banner. iOS Safari shows share-instructions variant. Settings entry visible only when not standalone.

### Step 5 — update toast

- Create `components/pwa/UpdateToast.tsx`
- Wire `wb.addEventListener('waiting', ...)` in `PwaProviders`

**Verifies:** build → deploy a small change → second visit shows the toast. Refresh → reloads on new SW. Later → dismisses, next reload picks it up.

### Step 6 — Capacitor build hardening

- Update `scripts/mobile-build.js` to stash/restore SW + manifest files
- Confirm `metadata.manifest` is conditional on `!isMobile`

**Verifies:** `npm run cap:android` produces a build with no `sw.js`, no `manifest.json`, no install banner ever firing in WebView. Existing APK behavior unchanged.

## Risks

1. **GH Pages basePath in SW scope** — `/bookbuddy/sw.js` must register with scope `/bookbuddy/`. The `scope: basePath + '/'` in next-pwa config handles it; verify by inspecting DevTools → Application → Service Workers after `deploy:gh-pages`.
2. **Next.js + next-pwa version drift** — `@ducanh2912/next-pwa` lags Next.js minor releases occasionally. Pin a known-good version in `package.json`.
3. **Existing users on the old SW** — `cleanupOutdatedCaches: true` will purge the old `bookbuddy-v2` cache. First load after deploy may feel slow as Workbox repopulates; subsequent loads are faster than before.
4. **`beforeinstallprompt` quirks** — Chrome only fires the event once. If `installPrompt.attach()` runs after the event already fired, the event is lost. Mounting `PwaProviders` at the root (synchronous render) before any user interaction handles this.

## Open questions

None at design time. Implementation may surface specifics around:
- Exact toast and banner styling to match BookBuddy's mobile-first aesthetic
- Whether the existing CI workflow file structure can host the `pwa:assets:check` step or a new workflow is needed

## Decisions

| Question | Choice | Reasoning |
|---|---|---|
| Tooling: vite-plugin-pwa? | No — `@ducanh2912/next-pwa` | Project is Next.js, not Vite |
| Migration depth | Full migration (Workbox-generated SW) | Hand-rolling precache for Next.js static export is exactly what Workbox automates |
| Install trigger | Intent-based, fires on book-tap from library | iOS users won't enter API keys before installing; library browsing is the realistic pre-install flow. Ties install pitch to a concrete value prop ("keep this book offline") |
| Update flow | Prompted toast (Refresh / Later) | Forced is too disruptive given long AI calls; silent leaves users on stale builds |
| Offline scope | App shell + library catalog runtime-cached | Matches install pitch; user data already in IndexedDB. Caching EPUB blobs is redundant once imported |
| Asset pipeline | Single SVG source (`icon.svg`); separate `logo.svg` | Square app icon and in-app wordmark serve different purposes |
| iOS splashes | Generated by `pwa-asset-generator` | Replaces the runtime canvas trick |
| Capacitor handling | Strip SW + manifest from APK build | Capacitor uses its own asset loader; PWA machinery is at best inert, at worst conflicting |
| Auto-regeneration | Husky + lint-staged pre-commit hook + CI check | Works for every developer regardless of editor; CI catches `--no-verify` bypasses |
