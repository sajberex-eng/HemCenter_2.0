'use client';

import { useEffect, useState } from 'react';
import type { DecisionAnswer, DecisionDto, DecisionStatus } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';
import { ErrorText, useErrorText } from '../ui';

const STATUS_STYLE: Record<DecisionStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-900',
  OBJECTIONS: 'bg-red-100 text-red-800',
  CONFIRMED: 'bg-green-100 text-green-800',
};
const ANSWER_KEY: Record<DecisionAnswer, Key> = { AGREE: 'decision.agree', OBJECT: 'decision.object', ACKNOWLEDGED: 'decision.ack' };

/** A decision under the message it was made from: who answered what, and the buttons for those who still must. */
export function DecisionCard({ decision, readOnly }: { decision: DecisionDto; readOnly?: boolean }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { nameOf, ensurePeople } = useChats();
  const errorText = useErrorText();
  // the server's answer shows at once; the live update that follows replaces it
  const [fresh, setFresh] = useState<DecisionDto | null>(null);
  const [objecting, setObjecting] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const d = fresh ?? decision;

  useEffect(() => setFresh(null), [decision]);
  useEffect(() => ensurePeople([d.createdById, ...d.addresseeIds]), [d.createdById, d.addresseeIds, ensurePeople]);

  const mine = d.responses.find((r) => r.userId === user?.id);
  const iAmAddressee = !!user && d.addresseeIds.includes(user.id);
  const answered = d.responses.filter((r) => d.addresseeIds.includes(r.userId)).length;

  async function answer(a: DecisionAnswer, text?: string) {
    setError(undefined);
    if (a === 'OBJECT' && !text?.trim()) return setError(t('decision.commentRequired'));
    try {
      setFresh(await api<DecisionDto>(`/decisions/${d.id}/answer`, { method: 'POST', body: { answer: a, comment: text?.trim() || undefined } }));
      setObjecting(false);
      setComment('');
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="mb-1 rounded-lg border border-black/10 bg-white/70 p-2 text-sm" data-testid="decision-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">⚖ {t('decision.title')}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[d.status]}`} data-testid="decision-status">
          {t(`decision.status.${d.status}` as Key)}
        </span>
      </div>
      {d.text && <p className="whitespace-pre-wrap break-words">{d.text}</p>}
      <p className="mt-1 text-xs text-slate-600">{t('decision.progress', { n: answered, m: d.addresseeIds.length })}</p>

      <ul className="mt-1 space-y-0.5 text-xs">
        {d.addresseeIds.map((id) => {
          const r = d.responses.find((x) => x.userId === id);
          return (
            <li key={id} data-testid="decision-response">
              <span className="font-medium">{nameOf(id)}</span>
              {': '}
              {r ? <span className={r.answer === 'OBJECT' ? 'text-red-700' : 'text-green-800'}>{t(ANSWER_KEY[r.answer])}</span> : <span className="text-slate-500">…</span>}
              {r?.comment && <span className="text-slate-700"> — {r.comment}</span>}
            </li>
          );
        })}
      </ul>

      {iAmAddressee && !readOnly && (
        <div className="mt-2 space-y-2">
          <ErrorText>{error}</ErrorText>
          {objecting ? (
            <div className="space-y-2">
              <textarea
                aria-label={t('decision.comment')}
                data-testid="decision-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={1000}
                className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
              <div className="flex gap-2">
                <button type="button" data-testid="decision-send" onClick={() => answer('OBJECT', comment)} className="min-h-9 rounded-lg bg-red-700 px-3 text-xs font-medium text-white">
                  {t('decision.send')}
                </button>
                <button type="button" onClick={() => setObjecting(false)} className="min-h-9 rounded-lg px-3 text-xs text-slate-600 hover:bg-black/5">
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(['AGREE', 'OBJECT', 'ACKNOWLEDGED'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  data-testid={`decision-${a === 'AGREE' ? 'agree' : a === 'OBJECT' ? 'object' : 'ack'}`}
                  aria-pressed={mine?.answer === a}
                  onClick={() => (a === 'OBJECT' ? setObjecting(true) : answer(a))}
                  className={`min-h-9 rounded-lg border px-3 text-xs font-medium ${mine?.answer === a ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}
                >
                  {t(ANSWER_KEY[a])}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
