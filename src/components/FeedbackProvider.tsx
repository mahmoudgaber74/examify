import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

type FeedbackTone = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: FeedbackTone;
  title?: string;
}

interface ConfirmRequest {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone: 'danger' | 'brand';
  resolve: (value: boolean) => void;
}

interface FeedbackContextValue {
  toast: (message: string, tone?: FeedbackTone, title?: string) => void;
  confirm: (message: string, options?: Omit<Partial<ConfirmRequest>, 'message' | 'resolve'>) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const toneConfig: Record<FeedbackTone, { icon: typeof CheckCircle2; iconClass: string; barClass: string; title: string }> = {
  success: { icon: CheckCircle2, iconClass: 'text-accent-600', barClass: 'bg-accent-500', title: 'تمت العملية' },
  error: { icon: XCircle, iconClass: 'text-danger-600', barClass: 'bg-danger-500', title: 'تعذر إتمام العملية' },
  warning: { icon: AlertCircle, iconClass: 'text-warning-600', barClass: 'bg-warning-500', title: 'تنبيه' },
  info: { icon: Info, iconClass: 'text-brand-600', barClass: 'bg-brand-500', title: 'معلومة' },
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const nextId = useRef(0);

  const toast = useCallback((message: string, tone: FeedbackTone = 'info', title?: string) => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-3), { id, message, tone, title }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), tone === 'error' ? 7000 : 4500);
  }, []);

  useEffect(() => {
    const nativeAlert = window.alert;
    window.alert = (message?: string) => toast(String(message ?? ''), 'info');
    return () => { window.alert = nativeAlert; };
  }, [toast]);

  const confirm = useCallback((message: string, options: Omit<Partial<ConfirmRequest>, 'message' | 'resolve'> = {}) => new Promise<boolean>((resolve) => {
    setConfirmRequest({
      message,
      title: options.title ?? 'تأكيد العملية',
      confirmLabel: options.confirmLabel ?? 'تأكيد',
      cancelLabel: options.cancelLabel ?? 'إلغاء',
      tone: options.tone ?? 'danger',
      resolve,
    });
  }), []);

  const closeConfirm = (value: boolean) => {
    confirmRequest?.resolve(value);
    setConfirmRequest(null);
  };

  const value = useMemo(() => ({ toast, confirm }), [confirm, toast]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="feedback-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((item) => {
          const config = toneConfig[item.tone];
          const Icon = config.icon;
          return (
            <div key={item.id} className="feedback-toast" data-tone={item.tone} role={item.tone === 'error' ? 'alert' : 'status'}>
              <div className={`feedback-toast-icon ${config.iconClass}`}><Icon size={19} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-700 text-ink-900">{item.title ?? config.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-ink-600 break-words">{item.message}</p>
              </div>
              <button type="button" onClick={() => setToasts((current) => current.filter((toastItem) => toastItem.id !== item.id))} className="feedback-toast-close" aria-label="إغلاق التنبيه"><X size={16} /></button>
              <span className={`feedback-toast-bar ${config.barClass}`} />
            </div>
          );
        })}
      </div>
      {confirmRequest && (
        <div className="feedback-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeConfirm(false); }}>
          <div className="feedback-confirm" role="alertdialog" aria-modal="true" aria-labelledby="feedback-confirm-title">
            <div className="feedback-confirm-icon"><AlertCircle size={22} /></div>
            <div className="min-w-0 flex-1">
              <h2 id="feedback-confirm-title" className="text-base font-800 text-ink-900">{confirmRequest.title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">{confirmRequest.message}</p>
            </div>
            <button type="button" onClick={() => closeConfirm(false)} className="feedback-confirm-close" aria-label="إغلاق"><X size={18} /></button>
            <div className="feedback-confirm-actions">
              <button type="button" onClick={() => closeConfirm(false)} className="btn-outline">{confirmRequest.cancelLabel}</button>
              <button type="button" onClick={() => closeConfirm(true)} className={confirmRequest.tone === 'danger' ? 'btn-danger' : 'btn-primary'}>{confirmRequest.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside FeedbackProvider');
  return context;
}
