const DEFAULT_PRIMARY = '#1a55f5';

const DEFAULT_PALETTE: Record<number, string> = {
  50: '238 245 255',
  100: '217 232 255',
  200: '188 214 255',
  300: '142 188 255',
  400: '88 151 255',
  500: '49 116 255',
  600: '26 85 245',
  700: '20 66 225',
  800: '23 55 182',
  900: '25 51 143',
  950: '20 33 87',
};

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHex(value: string) {
  const normalized = value.trim().replace(/^#/, '');
  const expanded = normalized.length === 3 ? normalized.split('').map((part) => part + part).join('') : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function mix(base: { r: number; g: number; b: number }, target: { r: number; g: number; b: number }, amount: number) {
  return `${clamp(base.r + (target.r - base.r) * amount)} ${clamp(base.g + (target.g - base.g) * amount)} ${clamp(base.b + (target.b - base.b) * amount)}`;
}

function buildPalette(primary: string) {
  const base = parseHex(primary);
  if (!base) return DEFAULT_PALETTE;
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  return {
    50: mix(base, white, 0.95),
    100: mix(base, white, 0.86),
    200: mix(base, white, 0.68),
    300: mix(base, white, 0.44),
    400: mix(base, white, 0.2),
    500: mix(base, white, 0.06),
    600: `${base.r} ${base.g} ${base.b}`,
    700: mix(base, black, 0.12),
    800: mix(base, black, 0.24),
    900: mix(base, black, 0.38),
    950: mix(base, black, 0.58),
  };
}

export function applyInstitutionTheme(primaryColor?: string | null) {
  if (typeof document === 'undefined') return;
  const palette = buildPalette(primaryColor || DEFAULT_PRIMARY);
  const root = document.documentElement;
  Object.entries(palette).forEach(([shade, value]) => root.style.setProperty(`--brand-${shade}`, value));
  root.style.setProperty('--brand-primary', `#${(primaryColor || DEFAULT_PRIMARY).replace(/^#/, '')}`);
}
