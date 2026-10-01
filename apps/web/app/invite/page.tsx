'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorText, Field, Input, LocaleSwitcher, PatientDataWarning, useErrorText } from '@/components/ui';

function InviteForm() {
  const { t } = useI18n();
  const { acceptInvite } = useAuth();
  const router = useRouter();
  const errorText = useErrorText();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (token.length < 20) return <ErrorText>{t('invite.missingToken')}</ErrorText>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await acceptInvite(token, password, consent);
      router.replace('/');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">{t('invite.intro')}</p>
      <Field label={t('invite.password')} hint={t('invite.passwordHint')}>
        <Input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 size-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('invite.consent')}</span>
      </label>
      <PatientDataWarning />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy || !consent} className="w-full">
        {t('invite.submit')}
      </Button>
    </form>
  );
}

export default function InvitePage() {
  const { t } = useI18n();
  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold text-teal-800">{t('invite.title')}</h1>
        <LocaleSwitcher />
      </div>
      <Card>
        <Suspense fallback={<p>{t('loading')}</p>}>
          <InviteForm />
        </Suspense>
      </Card>
    </main>
  );
}
