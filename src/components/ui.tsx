import { type HTMLAttributes, type ReactNode } from 'react';

export function Sparkline({ data, tone = 'brand', className = '' }: { data: number[]; tone?: 'brand' | 'accent' | 'gold' | 'danger' | 'warning'; className?: string }) {
  const colors = {
    brand: '#3174ff',
    accent: '#10b981',
    gold: '#eab308',
    danger: '#ef4444',
    warning: '#f59e0b',
  } as const;
  const color = colors[tone];
  const w = 120;
  const h = 36;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPts = `0,${h} ${pts.join(' ')} ${w},${h}`;
  const id = `spark-${tone}-${data.join('-').slice(0, 12)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${id})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Card({ children, className = '', hover = false, ...props }: { children: ReactNode; className?: string; hover?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`card ${hover ? 'transition-all duration-300 hover:shadow-pop hover:-translate-y-0.5' : ''} ${className}`}>{children}</div>;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
      <div>
        <h2 className="font-display text-xl font-700 text-ink-900 tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-ink-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'accent' | 'gold' | 'danger' | 'warning' }) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700',
    brand: 'bg-brand-50 text-brand-700',
    accent: 'bg-accent-50 text-accent-700',
    gold: 'bg-gold-500/10 text-gold-600',
    danger: 'bg-danger-50 text-danger-700',
    warning: 'bg-warning-50 text-warning-600',
  } as const;
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function ProgressBar({ value, tone = 'brand', className = '' }: { value: number; tone?: 'brand' | 'accent' | 'gold' | 'danger' | 'warning'; className?: string }) {
  const tones = {
    brand: 'bg-brand-500',
    accent: 'bg-accent-500',
    gold: 'bg-gold-500',
    danger: 'bg-danger-500',
    warning: 'bg-warning-500',
  } as const;
  return (
    <div className={`h-1.5 w-full rounded-full bg-ink-100 overflow-hidden ${className}`}>
      <div className={`h-full rounded-full ${tones[tone]} transition-all duration-700`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string; size?: number }) {
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('');
  if (src) {
    return <img src={src} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full bg-brand-100 text-brand-700 font-600 flex items-center justify-center" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-ink-300">{icon}</div>}
      <p className="font-600 text-ink-700">{title}</p>
      {subtitle && <p className="text-sm text-ink-400 mt-1">{subtitle}</p>}
    </div>
  );
}
