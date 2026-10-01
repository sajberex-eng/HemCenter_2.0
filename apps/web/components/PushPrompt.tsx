'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { Button } from './ui';

const KEY = 'hc_push_prompt_dismissed';

/** One-time offer to switch notifications on (shown until the person answers; "later" hides it for good). */
export function PushPrompt() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!user) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(`${KEY}:${user.id}`) === '1';
    } catch {
      /* storage blocked: ask again next time */
    }
    if (dismissed) return;
    pushState().then((s) => {
      setState(s);
      setHidden(s !== 'off' && s !== 'ios-install');
    });
  }, [user]);

  if (hidden || !state || !user) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(`${KEY}:${user.id}`, '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div role="region" aria-label={t('notif.title')} data-testid="push-prompt" className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
      <p className="mb-2 font-medium text-teal-900">{state === 'ios-install' ? t('notif.iosInstall') : t('notif.promptTitle')}</p>
      <div className="flex gap-2">
        {state === 'off' && (
          <Button
            onClick={async () => {
              const next = await enablePush().catch(() => 'off' as PushState);
              if (next === 'on' || next === 'denied') dismiss();
            }}
          >
            {t('notif.enable')}
          </Button>
        )}
        <Button variant="secondary" onClick={dismiss}>{state === 'ios-install' ? t('chats.close') : t('notif.later')}</Button>
      </div>
    </div>
  );
}
