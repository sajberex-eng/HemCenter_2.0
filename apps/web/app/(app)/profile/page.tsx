'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';
import { NotificationsSection } from '@/components/NotificationsSection';
import { SecuritySection } from '@/components/SecuritySection';
import { WorkloadSection } from '@/components/WorkloadSection';
import { Button, Card, ErrorText, Field, Input, PageTitle, useErrorText } from '@/components/ui';

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const router = useRouter();
  const errorText = useErrorText();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/auth/change-password', { method: 'POST', body: form });
      // the server revoked every session, including this one
      setAccessToken(null);
      alert(t('profile.changed'));
      window.location.assign('/login');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function logoutAll() {
    await api('/auth/logout-all', { method: 'POST' });
    setAccessToken(null);
    window.location.assign('/login');
  }

  return (
    <div className="max-w-md space-y-4">
      <PageTitle>{t('profile.title')}</PageTitle>
      <Card>
        <div className="font-medium">{user?.fullName}</div>
        <div className="text-sm text-slate-600">@{user?.login}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {user?.roles.map((r) => <span key={r} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t(`role.${r}` as Key)}</span>)}
        </div>
      </Card>
      <WorkloadSection />
      <NotificationsSection />
      <SecuritySection />
      <Card>
        <form onSubmit={change} className="space-y-3">
          <h2 className="font-medium">{t('profile.changePassword')}</h2>
          <Field label={t('profile.current')}>
            <Input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </Field>
          <Field label={t('profile.new')} hint={t('invite.passwordHint')}>
            <Input type="password" autoComplete="new-password" required minLength={10} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>{t('save')}</Button>
        </form>
      </Card>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={logoutAll}>{t('profile.logoutAll')}</Button>
        <Button variant="secondary" onClick={logout}>{t('logout')}</Button>
      </div>
    </div>
  );
}
