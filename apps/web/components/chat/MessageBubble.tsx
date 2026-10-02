'use client';

import { useState } from 'react';
import type { MessageDto } from '@hemcenter/shared';
import { useI18n } from '@/lib/i18n';
import { formatTime, tokenize } from '@/lib/chatUtils';
import { AttachmentView } from './AttachmentView';
import { DecisionCard } from '../work/DecisionCard';
import { TaskCard } from '../work/TaskCard';

export type ReadState = { kind: 'direct'; read: boolean } | { kind: 'group'; read: number; total: number };

interface Props {
  message: MessageDto;
  mine: boolean;
  /** Author name, shown above others' messages in groups. */
  authorName?: string;
  mentionNames: string[];
  replyAuthorName?: string;
  readState?: ReadState;
  /** Briefly emphasised after jumping to it from a search result or a pin. */
  highlighted?: boolean;
  /** Archived history: no actions, no read ticks. */
  readOnly?: boolean;
  canPin?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Offered only where the chat is writable; the management view passes neither. */
  onTask?: () => void;
  onDecision?: () => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MessageBubble({ message, mine, authorName, mentionNames, replyAuthorName, readState, highlighted, readOnly, canPin, pinned, onTogglePin, onTask, onDecision, onReply, onEdit, onDelete }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);

  const receipt = () => {
    if (!mine || message.deleted || !readState) return null;
    if (readState.kind === 'direct') {
      return (
        <span aria-label={readState.read ? t('chats.read') : t('chats.sent')} title={readState.read ? t('chats.read') : t('chats.sent')} className={readState.read ? 'text-teal-700' : 'text-slate-400'}>
          {readState.read ? '✓✓' : '✓'}
        </span>
      );
    }
    const all = readState.read >= readState.total;
    const label = t('chats.readBy', { n: readState.read, m: readState.total });
    return (
      <span aria-label={label} title={label} className={all ? 'text-teal-700' : 'text-slate-400'}>
        {all ? '✓✓' : `✓ ${readState.read}/${readState.total}`}
      </span>
    );
  };

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`} data-testid="message" data-seq={message.seq}>
      <div className={`group max-w-[85%] rounded-2xl px-3 py-2 shadow-sm transition-shadow md:max-w-[70%] ${mine ? 'rounded-br-sm bg-teal-100' : 'rounded-bl-sm bg-white'} ${highlighted ? 'ring-2 ring-yellow-400' : ''}`}>
        {authorName && !mine && <div className="mb-0.5 text-xs font-medium text-teal-800">{authorName}</div>}

        {message.replyTo && (
          <div className="mb-1 rounded-lg border-l-4 border-teal-600 bg-black/5 px-2 py-1 text-xs">
            <div className="font-medium text-teal-800">{replyAuthorName}</div>
            <div className="line-clamp-2 text-slate-600">{message.replyTo.body === null ? t('chats.deletedMessage') : message.replyTo.body || t('chats.fileOnly')}</div>
          </div>
        )}

        {message.deleted ? (
          <p className="text-sm italic text-slate-500">{t('chats.deletedMessage')}</p>
        ) : (
          <>
            {message.attachments.length > 0 && (
              <div className="mb-1 space-y-1">
                {message.attachments.map((a) => (
                  <AttachmentView key={a.id} a={a} />
                ))}
              </div>
            )}
            {message.decision && <DecisionCard decision={message.decision} readOnly={readOnly} />}
            {message.tasks.map((task) => (
              <TaskCard key={task.id} task={task} readOnly={readOnly} />
            ))}
            {message.body && (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                {tokenize(message.body, mentionNames).map((p, i) =>
                  p.kind === 'link' ? (
                    <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">
                      {p.text}
                    </a>
                  ) : p.kind === 'mention' ? (
                    <span key={i} className="rounded bg-teal-200/70 px-0.5 font-medium text-teal-900">
                      {p.text}
                    </span>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </p>
            )}
          </>
        )}

        <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-500">
          {message.editedAt && !message.deleted && <span>{t('chats.edited')}</span>}
          <span>{formatTime(message.createdAt, locale)}</span>
          {receipt()}
          {!message.deleted && !readOnly && (
            <button
              type="button"
              aria-label={t('chats.actions')}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="-my-1 min-h-8 min-w-8 rounded px-1 text-base leading-none text-slate-500 hover:bg-black/5"
            >
              ⋯
            </button>
          )}
        </div>

        {open && !message.deleted && (
          <div className="mt-1 flex flex-wrap justify-end gap-2 border-t border-black/10 pt-1 text-xs">
            <button type="button" className="min-h-8 rounded px-2 text-teal-800 hover:bg-black/5" onClick={() => { setOpen(false); onReply(); }}>
              {t('chats.reply')}
            </button>
            {onTask && (
              <button type="button" className="min-h-8 rounded px-2 text-teal-800 hover:bg-black/5" onClick={() => { setOpen(false); onTask(); }}>
                {t('tasks.fromMessage')}
              </button>
            )}
            {onDecision && !message.decision && (
              <button type="button" className="min-h-8 rounded px-2 text-teal-800 hover:bg-black/5" onClick={() => { setOpen(false); onDecision(); }}>
                {t('decision.create')}
              </button>
            )}
            {canPin && onTogglePin && (
              <button type="button" className="min-h-8 rounded px-2 text-teal-800 hover:bg-black/5" onClick={() => { setOpen(false); onTogglePin(); }}>
                {pinned ? t('chats.unpin') : t('chats.pin')}
              </button>
            )}
            {mine && (
              <>
                <button type="button" className="min-h-8 rounded px-2 text-teal-800 hover:bg-black/5" onClick={() => { setOpen(false); onEdit(); }}>
                  {t('edit')}
                </button>
                <button type="button" className="min-h-8 rounded px-2 text-red-700 hover:bg-black/5" onClick={() => { setOpen(false); onDelete(); }}>
                  {t('delete')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
