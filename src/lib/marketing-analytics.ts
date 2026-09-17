import { supabase } from './auth';

export type TrackingConsent = 'unknown' | 'granted' | 'denied';

export type MarketingEventName =
  | 'page_view'
  | 'signup_start'
  | 'signup_step'
  | 'signup_submit'
  | 'sign_up'
  | 'signup_error'
  | 'login'
  | 'login_error'
  | 'cta_click';

const CONSENT_KEY = 'examify.marketing.consent';
const CLIENT_ID_KEY = 'examify.marketing.client_id';
const ATTRIBUTION_KEY = 'examify.marketing.attribution';

interface AttributionData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  landing_path?: string;
  first_seen_at?: string;
}

type BrowserWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
  ttq?: { track?: (name: string, properties?: Record<string, unknown>) => void; page?: () => void };
};

function browserWindow() {
  return typeof window === 'undefined' ? null : window as BrowserWindow;
}

function readStorage<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function getTrackingConsent(): TrackingConsent {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function setTrackingConsent(consent: Exclude<TrackingConsent, 'unknown'>) {
  try { window.localStorage.setItem(CONSENT_KEY, consent); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('examify:tracking-consent', { detail: consent }));
}

export function getClientId() {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return 'anonymous';
  }
}

export function captureAttribution() {
  if (typeof window === 'undefined') return {} as AttributionData;
  const params = new URLSearchParams(window.location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid'] as const;
  const current = readStorage<AttributionData>(ATTRIBUTION_KEY) ?? {};
  const next: AttributionData = { ...current };
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) next[key] = value.slice(0, 180);
  }
  if (!next.landing_path) next.landing_path = `${window.location.pathname}${window.location.search}`.slice(0, 500);
  if (!next.first_seen_at) next.first_seen_at = new Date().toISOString();
  writeStorage(ATTRIBUTION_KEY, next);
  return next;
}

function eventPayload(parameters: Record<string, unknown> = {}) {
  const attribution = captureAttribution();
  return {
    ...parameters,
    ...attribution,
    client_id: getClientId(),
    page_path: typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`.slice(0, 500),
  };
}

function loadScript(src: string, id: string) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

export function initializeMarketingTags() {
  if (typeof window === 'undefined' || getTrackingConsent() !== 'granted') return;
  const current = browserWindow();
  if (!current) return;
  const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
  const metaId = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
  const tiktokId = import.meta.env.VITE_TIKTOK_PIXEL_ID as string | undefined;

  if (gaId && !current?.gtag) {
    current.dataLayer = current.dataLayer ?? [];
    current.gtag = (...args: unknown[]) => current.dataLayer?.push(args);
    current.gtag('js', new Date());
    current.gtag('config', gaId, { send_page_view: false });
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`, 'examify-ga-script');
  }

  if (metaId && !current?.fbq) {
    const queue: ((...args: unknown[]) => void) & { loaded?: boolean; version?: string; queue?: unknown[] } = (...args: unknown[]) => { queue.queue = queue.queue ?? []; queue.queue.push(args); };
    queue.loaded = true;
    queue.version = '2.0';
    queue.queue = [];
    current.fbq = queue;
    current.fbq('init', metaId);
    current.fbq('track', 'PageView');
    loadScript('https://connect.facebook.net/en_US/fbevents.js', 'examify-meta-script');
  }

  if (tiktokId && !current.ttq) {
    const queue: NonNullable<BrowserWindow['ttq']> & { load?: (id: string) => void; queue?: unknown[] } = {
      queue: [],
      load: (id: string) => queue.queue?.push(['load', id]),
      page: () => queue.queue?.push(['page']),
      track: (name: string, properties?: Record<string, unknown>) => queue.queue?.push(['track', name, properties]),
    };
    current.ttq = queue;
    queue.load?.(tiktokId);
    queue.page?.();
    loadScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(tiktokId)}&lib=ttq`, 'examify-tiktok-script');
  }
}

const metaEventMap: Partial<Record<MarketingEventName, string>> = {
  sign_up: 'CompleteRegistration',
  login: 'Login',
  cta_click: 'ViewContent',
};

export function trackMarketingEvent(name: MarketingEventName, parameters: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  const payload = eventPayload(parameters);
  const current = browserWindow();
  const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
  const metaId = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
  const tiktokId = import.meta.env.VITE_TIKTOK_PIXEL_ID as string | undefined;

  window.dispatchEvent(new CustomEvent('examify:marketing-event', { detail: { name, payload } }));
  if (getTrackingConsent() !== 'granted') return;
  void persistMarketingEvent(name, payload);
  initializeMarketingTags();
  if (gaId) current?.gtag?.('event', name, payload);
  if (metaId && current?.fbq) current.fbq('track', metaEventMap[name] ?? name, payload);
  if (tiktokId) current?.ttq?.track?.(name, payload);
}

async function persistMarketingEvent(name: MarketingEventName, payload: Record<string, unknown>) {
  try {
    const clientId = typeof payload.client_id === 'string' ? payload.client_id.slice(0, 80) : 'anonymous';
    const pagePath = typeof payload.page_path === 'string' ? payload.page_path.slice(0, 500) : '/';
    await supabase.from('marketing_events').insert({
      client_id: clientId,
      event_name: name,
      page_path: pagePath,
      parameters: payload,
    });
  } catch {
    // Analytics must never block signup, login, or the public landing page.
  }
}
