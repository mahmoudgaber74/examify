import { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if running as PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(isStandalone);

    // Check if iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS && !isStandalone);

    // Listen for beforeinstallprompt (Android/Desktop)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);

      // Don't show if already dismissed recently
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (!dismissed || Date.now() - parseInt(dismissed) > 7 * 24 * 60 * 60 * 1000) {
        setTimeout(() => setShowPrompt(true), 3000);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Show iOS prompt after delay
    if (iOS && !isStandalone) {
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (!dismissed || Date.now() - parseInt(dismissed) > 7 * 24 * 60 * 60 * 1000) {
        setTimeout(() => setShowPrompt(true), 3000);
      }
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  if (isInstalled || !showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-slide-in">
      <div className="mx-auto max-w-md bg-white rounded-2xl shadow-lg border border-ink-100 overflow-hidden">
        {isIOS ? (
          // iOS Instructions
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="grid place-items-center w-12 h-12 rounded-xl bg-brand-100 text-brand-600 shrink-0">
                <Smartphone size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-600 text-ink-900">تثبيت التطبيق</h3>
                <p className="text-sm text-ink-600 mt-1">
                  اضغط على
                  <span className="inline-block mx-1 px-2 py-0.5 bg-ink-100 rounded text-xs">
                    <svg className="inline w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83L9.42 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2-2 2H6c-1.11 0-2-.9-2-2V10c0-1.1.89-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .9 2 2z"/>
                    </svg>
                  </span>
                  ثم "إضافة إلى الشاشة الرئيسية"
                </p>
              </div>
              <button onClick={handleDismiss} className="text-ink-400 hover:text-ink-600">
                <X size={20} />
              </button>
            </div>
          </div>
        ) : (
          // Android/Desktop Prompt
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="grid place-items-center w-12 h-12 rounded-xl bg-brand-100 text-brand-600 shrink-0">
                <Download size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-600 text-ink-900">حمّل التطبيق</h3>
                <p className="text-sm text-ink-600 mt-1">
                  ثبّت التطبيق على جهازك للوصول السريع وتجربة أفضل
                </p>
              </div>
              <button onClick={handleDismiss} className="text-ink-400 hover:text-ink-600">
                <X size={20} />
              </button>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleInstall}
                className="flex-1 py-2 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-600 text-sm transition"
              >
                تثبيت الآن
              </button>
              <button
                onClick={handleDismiss}
                className="py-2 px-4 bg-ink-100 hover:bg-ink-200 text-ink-700 rounded-xl font-600 text-sm transition"
              >
                لاحقاً
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
