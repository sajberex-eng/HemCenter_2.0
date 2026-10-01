'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorText, Field, Input, LocaleSwitcher, useErrorText } from '@/components/ui';

export default function LoginPage() {
  const { t } = useI18n();
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const errorText = useErrorText();
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace('/');
  }, [ready, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(form.login, form.password);
      router.replace('/');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-teal-800">{t('appName')}</h1>
          <p className="text-sm text-slate-600">{t('appTagline')}</p>
        </div>
        <LocaleSwitcher />
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-lg font-medium">{t('login.title')}</h2>
          <Field label={t('login.login')}>
            <Input autoComplete="username" autoCapitalize="none" autoCorrect="off" required value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
          </Field>
          <Field label={t('login.password')}>
            <Input type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            {t('login.submit')}
          </Button>
        </form>
      </Card>
      <p className="text-center text-xs text-slate-500">{t('login.noAccount')}</p>
    </main>
  );
}
