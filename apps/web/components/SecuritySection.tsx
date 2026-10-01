'use client';

import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorText, Field, Input, useErrorText } from './ui';

type Phase = 'idle' | 'scan' | 'recovery';

/** Two-factor (TOTP) enrolment. The QR code is drawn in the browser, so the secret never reaches a third party. */
export function SecuritySection() {
  const { t } = useI18n();
  const { user, isAdmin, refreshUser } = useAuth();
  const errorText = useErrorText();
  const [phase, setPhase] = useState<Phase>('idle');
  const [setup, setSetup] = useState<{ secret: string; qr: string }>();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function start() {
    setError(undefined);
    setBusy(true);
    try {
      const res = await api<{ secret: string; uri: string }>('/auth/totp/setup', { method: 'POST' });
      setSetup({ secret: res.secret, qr: await QRCode.toDataURL(res.uri, { margin: 1, width: 220 }) });
      setPhase('scan');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const res = await api<{ recoveryCodes: string[] }>('/auth/totp/enable', { method: 'POST', body: { code: code.trim() } });
      setRecovery(res.recoveryCodes);
      setSetup(undefined);
      setCode('');
      setPhase('recovery');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await api('/auth/totp/disable', { method: 'POST', body: { password } });
      setPassword('');
      await refreshUser();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setRecovery([]);
    setPhase('idle');
    await refreshUser();
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{t('mfa.sectionTitle')}</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${user?.totpEnabled ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'}`}>
          {user?.totpEnabled ? t('mfa.enabled') : t('mfa.disabled')}
        </span>
      </div>
      {user?.mfaSetupRequired && phase === 'idle' && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('mfa.required')}</p>
      )}
      <ErrorText>{error}</ErrorText>

      {phase === 'idle' && !user?.totpEnabled && (
        <Button onClick={start} disabled={busy}>{t('mfa.start')}</Button>
      )}

      {phase === 'scan' && setup && (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-slate-600">{t('mfa.scan')}</p>
          <img src={setup.qr} alt="QR" width={220} height={220} className="rounded border border-slate-200" />
          <Field label={t('mfa.manualKey')}>
            <code className="block break-all rounded bg-slate-100 p-2 text-sm">{setup.secret}</code>
          </Field>
          <Field label={t('mfa.confirm')}>
            <Input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>{t('mfa.submit')}</Button>
        </form>
      )}

      {phase === 'recovery' && (
        <div className="space-y-3">
          <h3 className="font-medium">{t('mfa.recoveryTitle')}</h3>
          <p className="text-sm text-slate-600">{t('mfa.recoveryText')}</p>
          <ul data-testid="recovery-codes" className="grid grid-cols-2 gap-2 font-mono text-sm">
            {recovery.map((c) => <li key={c} className="rounded bg-slate-100 px-2 py-1">{c}</li>)}
          </ul>
          <Button onClick={finish}>{t('mfa.recoverySaved')}</Button>
        </div>
      )}

      {phase === 'idle' && user?.totpEnabled && !isAdmin && (
        <form onSubmit={disable} className="space-y-3">
          <Field label={t('mfa.disablePassword')}>
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="danger" disabled={busy}>{t('mfa.disable')}</Button>
        </form>
      )}
    </Card>
  );
}
