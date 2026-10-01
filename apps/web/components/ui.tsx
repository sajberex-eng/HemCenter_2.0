'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';

export function Button({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-400',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
    danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:opacity-50',
  }[variant];
  return <button {...p} className={`min-h-11 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${styles} ${className}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls = 'block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30';

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ''}`} />;

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-4 text-xl font-semibold text-slate-900">{children}</h1>;
}

/** Translates an API error code; unknown codes fall back to the generic message. */
export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      const key = `err.${e.code}` as Key;
      const text = t(key);
      return text === key ? t('err.GENERIC') : text;
    }
    return t('err.GENERIC');
  };
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm" role="group" aria-label="Language">
      {(['ru', 'kk'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`min-h-9 px-3 ${locale === l ? 'bg-teal-700 text-white' : 'bg-white text-slate-700'}`}
        >
          {l === 'ru' ? 'RU' : 'ҚАЗ'}
        </button>
      ))}
    </div>
  );
}

export function PatientDataWarning() {
  const { t } = useI18n();
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('warn.patientData')}</p>
  );
}
