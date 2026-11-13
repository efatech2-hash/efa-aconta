import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PLAY_STORE_URL =
  (import.meta.env && (import.meta.env as any).VITE_PLAY_STORE_URL) ||
  'https://play.google.com/store/apps/details?id=com.efa.technologie.aconta';

let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let globalInstalled = false;
const listeners = new Set<() => void>();
let initialized = false;

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

function notifyListeners() {
  listeners.forEach((cb) => cb());
}

export function initPWAInstallListener() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  globalInstalled = checkIsStandalone();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    globalInstalled = true;
    globalDeferredPrompt = null;
    notifyListeners();
  });

  const media = window.matchMedia?.('(display-mode: standalone)');
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', (ev) => {
      if (ev.matches) {
        globalInstalled = true;
        globalDeferredPrompt = null;
        notifyListeners();
      }
    });
  }
}

initPWAInstallListener();

export function usePWAInstall() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    initPWAInstallListener();
    const listener = () => forceUpdate((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const isIOS =
    typeof window !== 'undefined' &&
    /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());

  const isInstalled = globalInstalled || checkIsStandalone();
  const isInstallable = !isInstalled && Boolean(globalDeferredPrompt);

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!globalDeferredPrompt) return 'unavailable';
    try {
      await globalDeferredPrompt.prompt();
      const { outcome } = await globalDeferredPrompt.userChoice;
      if (outcome === 'accepted') {
        globalInstalled = true;
        globalDeferredPrompt = null;
        notifyListeners();
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  };

  return {
    isInstallable,
    isInstalled,
    isIOS,
    install,
  };
}
