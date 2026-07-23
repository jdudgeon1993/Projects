import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'nexus_install_dismissed';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISSED_KEY));
  const [isIos, setIsIos] = useState(false);
  const [isInStandaloneMode, setIsInStandaloneMode] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    setIsInStandaloneMode(standalone);

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIos(ios);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
    setDeferredPrompt(null);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
    else dismiss();
  }

  // Already installed, or user dismissed
  if (isInStandaloneMode || dismissed) return null;

  // Android/Desktop — native install prompt available
  if (deferredPrompt) {
    return (
      <div className="fixed bottom-20 inset-x-3 z-[2000] flex items-center gap-3 rounded-2xl border border-violet-500/40 bg-slate-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600">
          <svg viewBox="0 0 48 46" className="h-6 w-6" fill="white">
            <path d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">Add Nexus to Home Screen</p>
          <p className="text-xs text-slate-400">Works offline · Loads instantly</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={install}
            className="rounded-lg border border-violet-500 bg-violet-600/30 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-600/50"
          >
            Install
          </button>
        </div>
      </div>
    );
  }

  // iOS — no programmatic prompt, show manual instructions
  if (isIos) {
    return (
      <div className="fixed bottom-20 inset-x-3 z-[2000] rounded-2xl border border-violet-500/40 bg-slate-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600">
            <svg viewBox="0 0 48 46" className="h-6 w-6" fill="white">
              <path d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-100">Add Nexus to Home Screen</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
              Tap the <span className="font-semibold text-slate-300">Share</span> button{' '}
              <span className="inline-block">⬆</span> then{' '}
              <span className="font-semibold text-slate-300">Add to Home Screen</span>
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 text-slate-500 hover:text-slate-300"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return null;
}
