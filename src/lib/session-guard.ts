const DEVICE_STORAGE_KEY = 'examify.security.device-id';

export function getClientDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const generated = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'ephemeral-' + Math.random().toString(36).slice(2);
  }
}

export function getClientDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'browser';
  return navigator.userAgent.slice(0, 500);
}
