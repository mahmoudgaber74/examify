import { ar } from '../locales/ar';

export { ar };

export function getArabicErrorMessage(error: unknown): string {
  const message = getErrorField(error, 'message').toLowerCase();
  const code = getErrorField(error, 'code');
  const details = getErrorField(error, 'details').toLowerCase();
  const combined = `${message} ${code.toLowerCase()} ${details}`;

  if (
    combined.includes('row-level security') ||
    combined.includes('rls') ||
    combined.includes('permission denied') ||
    combined.includes('not authorized') ||
    combined.includes('unauthorized') ||
    code === '42501'
  ) {
    return ar.errors.unauthorized;
  }

  if (
    combined.includes('duplicate key') ||
    combined.includes('already exists') ||
    code === '23505'
  ) {
    return ar.errors.duplicate;
  }

  if (
    combined.includes('network') ||
    combined.includes('failed to fetch') ||
    combined.includes('fetch failed')
  ) {
    return ar.errors.network;
  }

  if (
    combined.includes('foreign key') ||
    code === '23503'
  ) {
    return ar.errors.foreignKey;
  }

  return ar.errors.unknown;
}

function getErrorField(error: unknown, field: 'message' | 'code' | 'details' | 'hint') {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}
