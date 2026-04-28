type Platform = 'android' | 'ios' | 'desktop' | 'unsupported';
export type InstallState = 'idle' | 'available' | 'ios-instructions' | 'installed' | 'dismissed';
export type InstallReason = 'book-tap' | 'settings';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'bb.pwa.installDismissed';
const SHOWN_KEY = 'bb.pwa.installShownAt';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

let deferred: BeforeInstallPromptEvent | null = null;
let currentState: InstallState = 'idle';
const listeners = new Set<(state: InstallState) => void>();

function emit(next: InstallState) {
  currentState = next;
  listeners.forEach((fn) => fn(next));
}

function recentlyShown(): boolean {
  if (typeof window === 'undefined') return false;
  const ts = window.localStorage.getItem(SHOWN_KEY);
  if (!ts) return false;
  const n = Number(ts);
  if (!Number.isFinite(n)) return false;
  return Date.now() - n < COOLDOWN_MS;
}

function detectPlatform(): Platform {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  if (isIos) return 'ios';
  if (deferred) {
    return /Android/i.test(ua) ? 'android' : 'desktop';
  }
  return 'unsupported';
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
}

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(DISMISS_KEY) === 'true';
}

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
}

function onAppInstalled() {
  deferred = null;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(DISMISS_KEY);
    window.localStorage.removeItem(SHOWN_KEY);
  }
  emit('installed');
}

export const installPrompt = {
  attach() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
  },
  detach() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', onAppInstalled);
  },
  subscribe(fn: (state: InstallState) => void) {
    listeners.add(fn);
    fn(currentState);
    return () => {
      listeners.delete(fn);
    };
  },
  state(): InstallState {
    return currentState;
  },
  platform: detectPlatform,
  isStandalone,
  isDismissed,
  maybeShow(reason: InstallReason) {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;
    if (reason === 'book-tap' && isDismissed()) return;
    if (reason === 'book-tap' && recentlyShown()) return;
    const p = detectPlatform();
    if (p === 'unsupported') return;
    emit(p === 'ios' ? 'ios-instructions' : 'available');
    if (reason === 'book-tap') {
      window.localStorage.setItem(SHOWN_KEY, String(Date.now()));
    }
  },
  async requestInstall(): Promise<'accepted' | 'dismissed' | 'no-prompt'> {
    if (!deferred) return 'no-prompt';
    await deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    if (choice.outcome === 'accepted') {
      emit('installed');
    } else {
      emit('idle');
    }
    return choice.outcome;
  },
  dismiss() {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DISMISS_KEY, 'true');
    emit('dismissed');
  },
  hide() {
    emit('idle');
  },
};
