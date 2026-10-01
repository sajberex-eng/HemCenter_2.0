'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGE_MAX_LENGTH } from '@hemcenter/shared';
import { useI18n } from '@/lib/i18n';
import { Avatar } from './Avatar';

export interface Candidate {
  id: string;
  name: string;
}

export interface ComposerProps {
  /** People who can be @mentioned (chat members except me). */
  candidates: Candidate[];
  banner?: { label: string; text: string; onCancel: () => void };
  /** Set while editing: the composer is filled with this text. */
  initialText?: string;
  editKey?: string;
  busy: boolean;
  onSend: (body: string, mentionIds: string[]) => Promise<boolean>;
}

const MENTION_AT_CARET = /(^|\s)@([^\s@]*)$/;

export function Composer({ candidates, banner, initialText, editKey, busy, onSend }: ComposerProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [query, setQuery] = useState<string | null>(null);

  // entering or leaving edit mode replaces the draft
  useEffect(() => {
    setText(initialText ?? '');
    setPicked([]);
    if (initialText !== undefined) ref.current?.focus();
  }, [editKey, initialText]);

  // grow with the content, up to a limit
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5);
  }, [query, candidates]);

  function onChange(value: string, caret: number) {
    setText(value);
    const m = MENTION_AT_CARET.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
  }

  function pick(c: Candidate) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(MENTION_AT_CARET, (_, lead: string) => `${lead}@${c.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((p) => (p.some((x) => x.id === c.id) ? p : [...p, c]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    // a mention only counts if its text is still in the message
    const mentionIds = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    if (await onSend(body, mentionIds)) {
      setText('');
      setPicked([]);
      setQuery(null);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') setQuery(null);
    // Enter sends with a physical keyboard; on touch screens Enter makes a new line and the button sends
    const hasKeyboard = window.matchMedia('(pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && hasKeyboard && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (suggestions.length > 0) pick(suggestions[0]);
      else void submit();
    }
  }

  return (
    <div className="safe-bottom relative border-t border-slate-200 bg-white p-2">
      {suggestions.length > 0 && (
        <ul role="listbox" className="absolute inset-x-2 bottom-full mb-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {suggestions.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-slate-50" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
                <Avatar id={c.id} name={c.name} size={28} />
                <span className="text-sm">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {banner && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border-l-4 border-teal-600 bg-slate-50 px-2 py-1 text-xs">
          <div className="min-w-0">
            <div className="font-medium text-teal-800">{banner.label}</div>
            <div className="truncate text-slate-600">{banner.text}</div>
          </div>
          <button type="button" aria-label={t('cancel')} className="min-h-8 min-w-8 rounded text-lg text-slate-500 hover:bg-slate-200" onClick={banner.onCancel}>
            ×
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          aria-label={t('chats.writeMessage')}
          placeholder={t('chats.writeMessage')}
          value={text}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          className="block max-h-40 min-h-11 w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-base focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !text.trim()}
          aria-label={t('chats.send')}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-300"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12 2-12 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
