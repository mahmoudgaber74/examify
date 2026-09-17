import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Check, X } from 'lucide-react';
import { captureAttribution, getTrackingConsent, initializeMarketingTags, setTrackingConsent } from '../lib/marketing-analytics';

export function MarketingAnalytics({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState(getTrackingConsent);

  useEffect(() => {
    captureAttribution();
    initializeMarketingTags();
    const handleConsent = (event: Event) => {
      const next = (event as CustomEvent<'granted' | 'denied'>).detail;
      setConsent(next);
      if (next === 'granted') initializeMarketingTags();
    };
    window.addEventListener('examify:tracking-consent', handleConsent);
    return () => window.removeEventListener('examify:tracking-consent', handleConsent);
  }, []);

  return (
    <>
      {children}
      {consent === 'unknown' && (
        <div className="consent-banner" role="dialog" aria-label="إعدادات الخصوصية">
          <div className="consent-banner-icon"><BarChart3 size={18} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-800 text-ink-900">نحترم خصوصيتك</p>
            <p className="mt-1 text-xs leading-5 text-ink-600">نستخدم قياسًا مجهولًا لتحسين تجربة المنصة وقياس الحملات. لا نرسل بيانات شخصية إلى أدوات الإعلانات.</p>
          </div>
          <div className="consent-actions">
            <button type="button" className="btn-outline !min-h-9 !px-3 !py-2 text-xs" onClick={() => setTrackingConsent('denied')}><X size={14} /> رفض</button>
            <button type="button" className="btn-primary !min-h-9 !px-3 !py-2 text-xs" onClick={() => setTrackingConsent('granted')}><Check size={14} /> موافق</button>
          </div>
        </div>
      )}
    </>
  );
}
