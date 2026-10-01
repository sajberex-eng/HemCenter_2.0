'use client';

import { useCallback, useEffect, useState } from 'react';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { tomorrowMorning } from '@/lib/prefs';
import { disablePush, enablePush, loadSettings, pushState, saveSettings, setSoundEnabled, soundEnabled, type NotificationSettings, type PushState } from '@/lib/push';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Field, Input, useErrorText } from './ui';

const STATUS: Record<PushState, Key> = {
  on: 'notif.status.on',
  off: 'notif.status.off',
  denied: 'notif.status.denied',
  unsupported: 'notif.status.unsupported',
  'server-off': 'notif.status.server',
  'ios-install': 'notif.status.off',
};

export function NotificationsSection() {
  const { t, locale } = useI18n();
  const { refreshPrefs } = useChats();
  const errorText = useErrorText();
  const [state, setState] = useState<PushState | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [quiet, setQuiet] = useState({ start: '', end: '' });
  const [sound, setSound] = useState(true);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState(await pushState());
    const s = await loadSettings().catch(() => null);
    setSettings(s);
    if (s) setQuiet({ start: s.quietStart ?? '', end: s.quietEnd ?? '' });
  }, []);

  useEffect(() => {
    setSound(soundEnabled());
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(undefined);
    setSaved(false);
    setBusy(true);
    try {
      await fn();
      refreshPrefs();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const patch = (p: Parameters<typeof saveSettings>[0]) =>
    run(async () => {
      const s = await saveSettings(p);
      setSettings(s);
      setQuiet({ start: s.quietStart ?? '', end: s.quietEnd ?? '' });
      setSaved(true);
    });

  // Controls stay disabled until the saved values have arrived: otherwise the answer would overwrite what was already typed.
  const loading = settings === null;
  const dndActive = settings?.dndUntil && new Date(settings.dndUntil) > new Date();
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{t('notif.title')}</h2>
        {state && <span className={`rounded px-2 py-0.5 text-xs ${state === 'on' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'}`} data-testid="push-state">{t(STATUS[state])}</span>}
      </div>
      <ErrorText>{error}</ErrorText>

      {state === 'ios-install' && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('notif.iosInstall')}</p>}
      {state === 'denied' && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('notif.deniedHelp')}</p>}
      {state === 'off' && (
        <Button disabled={busy} onClick={() => run(async () => setState(await enablePush()))}>
          {t('notif.enable')}
        </Button>
      )}
      {state === 'on' && (
        <Button variant="secondary" disabled={busy} onClick={() => run(async () => { await disablePush(); setState(await pushState()); })}>
          {t('notif.disable')}
        </Button>
      )}
      <p className="text-xs text-slate-500">{t('notif.privacy')}</p>

      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={sound} onChange={(e) => { setSound(e.target.checked); setSoundEnabled(e.target.checked); }} />
        {t('notif.sound')}
      </label>

      <section aria-label={t('notif.dnd')} className="space-y-2 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-medium">{t('notif.dnd')}</h3>
        {dndActive && settings?.dndUntil && <p className="text-sm text-slate-700" data-testid="dnd-until">{t('notif.dndUntil', { time: fmt(settings.dndUntil) })}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy || loading} onClick={() => patch({ dndUntil: new Date(Date.now() + 3600_000).toISOString() })}>{t('notif.dnd1h')}</Button>
          <Button variant="secondary" disabled={busy || loading} onClick={() => patch({ dndUntil: tomorrowMorning().toISOString() })}>{t('notif.dndTomorrow')}</Button>
          {dndActive && <Button variant="secondary" disabled={busy} onClick={() => patch({ dndUntil: null })}>{t('notif.dndOff')}</Button>}
        </div>
      </section>

      <section aria-label={t('notif.quiet')} className="space-y-2 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-medium">{t('notif.quiet')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('notif.quietFrom')}>
            <Input type="time" disabled={loading} value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} />
          </Field>
          <Field label={t('notif.quietTo')}>
            <Input type="time" disabled={loading} value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">{t('notif.quietHint')}</p>
        <div className="flex gap-2">
          <Button disabled={busy || !quiet.start || !quiet.end} onClick={() => patch({ quietStart: quiet.start, quietEnd: quiet.end })}>{t('save')}</Button>
          <Button variant="secondary" disabled={busy || (!settings?.quietStart && !settings?.quietEnd)} onClick={() => patch({ quietStart: null, quietEnd: null })}>{t('notif.quietClear')}</Button>
        </div>
      </section>
      {saved && <p role="status" className="text-sm text-teal-700">{t('notif.saved')}</p>}
    </Card>
  );
}
