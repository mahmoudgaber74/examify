import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render failed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div dir="rtl" className="min-h-screen bg-ink-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full rounded-2xl border border-danger-200 bg-white p-6 shadow-card">
          <div className="flex items-start gap-3">
            <div className="grid place-items-center w-11 h-11 rounded-xl bg-danger-50 text-danger-600 shrink-0">
              <AlertTriangle size={24} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-800 text-ink-900">حدث خطأ أثناء تشغيل التطبيق</h1>
              <p className="text-sm text-ink-500 mt-2">
                لم تعد الصفحة بيضاء. انسخ رسالة الخطأ التالية أو أعد تحميل الصفحة بعد مسح الكاش.
              </p>
              <pre className="mt-4 max-h-60 overflow-auto rounded-xl bg-ink-950 p-4 text-xs text-white whitespace-pre-wrap text-left" dir="ltr">
                {this.state.error.message}
                {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
              </pre>
              <button onClick={() => window.location.reload()} className="btn-primary mt-4">
                إعادة تحميل
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
