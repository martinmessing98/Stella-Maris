import type { UrgencyLevel } from '../types';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyExact(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateShort(isoDate: string): string {
  if (!isoDate) return '—';
  const parsed = new Date(isoDate.includes('T') ? isoDate : `${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function isSafeHttpUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function getGoogleMapsUrl(address?: string): string | undefined {
  const trimmed = address?.trim();
  if (!trimmed) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}

export function formatPhoneNumber(phone?: string): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return formatPhoneInput(trimmed);
}

export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 10 && digits.startsWith('1')) {
    const d = digits.slice(0, 11);
    if (d.length <= 4) return `1-${d.slice(1)}`;
    if (d.length <= 7) return `1-${d.slice(1, 4)}-${d.slice(4)}`;
    return `1-${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  }
  const d = digits.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function getTelHref(phone?: string): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.trim().replace(/(?!^\+)[^\d]/g, '');
  return cleaned.length >= 3 ? `tel:${cleaned}` : undefined;
}

export interface UrgencyMeta {
  level: UrgencyLevel;
  label: string;
  shortLabel: string;
  badgeClass: string;
  textClass: string;
  dotClass: string;
}

export const URGENCY_LEVELS: UrgencyMeta[] = [
  {
    level: 5,
    label: '5 - ASAP',
    shortLabel: '5 · ASAP',
    badgeClass: 'border-red-400 bg-red-200 text-red-950',
    textClass: 'text-red-950',
    dotClass: 'bg-red-900',
  },
  {
    level: 4,
    label: '4 - Urgent',
    shortLabel: '4 · Urgent',
    badgeClass: 'border-red-200 bg-red-50 text-red-600',
    textClass: 'text-red-600',
    dotClass: 'bg-red-600',
  },
  {
    level: 3,
    label: '3 - Can do when get a chance',
    shortLabel: '3 · When available',
    badgeClass: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    textClass: 'text-yellow-700',
    dotClass: 'bg-yellow-400',
  },
  {
    level: 2,
    label: '2 - Scheduled but nothing urgent',
    shortLabel: '2 · Scheduled',
    badgeClass: 'border-green-400 bg-green-200 text-green-900',
    textClass: 'text-green-800',
    dotClass: 'bg-green-700',
  },
  {
    level: 1,
    label: '1 - Low priority',
    shortLabel: '1 · Low priority',
    badgeClass: 'border-green-200 bg-green-50 text-green-700',
    textClass: 'text-green-600',
    dotClass: 'bg-green-400',
  },
];

export function getUrgencyMeta(level?: number): UrgencyMeta {
  const found = URGENCY_LEVELS.find((u) => u.level === level);
  return found || URGENCY_LEVELS[3]; // defaults to 2 - Scheduled but nothing urgent
}

