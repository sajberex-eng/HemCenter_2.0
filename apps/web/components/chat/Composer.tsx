'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { MESSAGE_MAX_LENGTH, type AttachmentDto } from '@hemcenter/shared';
import { api, apiUpload } from '@/lib/api';
import { formatSize } from '@/lib/useBlobUrl';
import { useI18n } from '@/lib/i18n';
import { completeMention, mentionQueryAt } from '@/lib/chatUtils';
import { useErrorText } from '../ui';
import { Avatar } from './Avatar';

export interface Candidate {
  id: string;
  name: string;
}

type Pending = { key: string; name: string; size: number; status: 'uploading' | 'done' | 'error'; id?: string; error?: string };
const MAX_FILES = 10;

export interface ComposerProps {
  /** Files are uploaded into this chat. */
  chatId: string;
  /** People who can be @mentioned (chat members except me). */
  candidates: Candidate[];
  banner?: { label: string; text: string; onCancel: () => void };
  /** Set while editing: the composer is filled with this text. */
  initialText?: string;
  editKey?: string;
  busy: boolean;
  onSend: (body: string, mentionIds: string[], attachmentIds: string[]) => Promise<boolean>;
}

export function Composer({ chatId, candidates, banner, initialText, editKey, busy, onSend }: ComposerProps) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  // Where to put the caret after the next render (set when a suggestion is inserted).
  const [caretTo, setCaretTo] = useState<number | null>(null);
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const withdrawn = useRef(new Set<string>()); // uploads the user removed while they were still in flight
  const editing = editKey !== undefined;

  // entering or leaving edit mode replaces the draft
  useEffect(() => {
    setText(initialText ?? '');
    setPicked([]);
    if (initialText !== undefined) ref.current?.focus();
  }, [editKey, initialText]);

  // Placing the caret in a layout effect runs right after React commits the new text and before the browser
  // handles another keystroke. (A requestAnimationFrame here could fire after the user had already typed a few
  // characters and drag the caret back, scrambling the text.)
  useLayoutEffect(() => {
    const el = ref.current;
    if (caretTo === null || !el) return;
    el.focus();
    el.setSelectionRange(caretTo, caretTo);
    setCaretTo(null);
  }, [caretTo]);

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
    setQuery(mentionQueryAt(value.slice(0, caret)));
  }

  function pick(c: Candidate) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = completeMention(text.slice(0, caret), c.name);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((p) => (p.some((x) => x.id === c.id) ? p : [...p, c]));
    setQuery(null);
    setCaretTo(before.length);
  }

  async function addFiles(list: File[]) {
    if (editing || list.length === 0) return;
    const room = MAX_FILES - files.length;
    for (const file of list.slice(0, Math.max(room, 0))) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setFiles((f) => [...f, { key, name: file.name || 'file', size: file.size, status: 'uploading' }]);
      const form = new FormData();
      form.append('file', file, file.name || 'image.png');
      apiUpload<AttachmentDto>(`/chats/${chatId}/attachments`, form).then(
        (a) => {
          if (withdrawn.current.delete(key)) {
            void api(`/attachments/${a.id}`, { method: 'DELETE' }).catch(() => undefined);
            return;
          }
          setFiles((f) => f.map((x) => (x.key === key ? { ...x, status: 'done', id: a.id, name: a.name, size: a.size } : x)));
        },
        (e) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, status: 'error', error: errorText(e) } : x))),
      );
    }
  }

  function removeFile(item: Pending) {
    setFiles((f) => f.filter((x) => x.key !== item.key));
    if (item.status === 'uploading') withdrawn.current.add(item.key);
    // a file that is already on the server but will not be sent is withdrawn right away
    if (item.status === 'done' && item.id) void api(`/attachments/${item.id}`, { method: 'DELETE' }).catch(() => undefined);
  }

  const uploading = files.some((f) => f.status === 'uploading');
  const doneIds = files.filter((f) => f.status === 'done' && f.id).map((f) => f.id!);

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length > 0 && !editing) {
      e.preventDefault(); // a screenshot pasted from the clipboard becomes an attachment, not text
      void addFiles(pasted);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  async function submit() {
    const body = text.trim();
    if ((!body && doneIds.length === 0) || busy || uploading) return;
    // a mention only counts if its text is still in the message
    const mentionIds = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    if (await onSend(body, mentionIds, doneIds)) {
      setText('');
      setFiles([]);
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
    <div
      className="safe-bottom relative border-t border-slate-200 bg-white p-2"
      onDragOver={(e) => {
        if (!editing && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded border-2 border-dashed border-teal-600 bg-teal-50/90 text-sm text-teal-800">
          {t('chats.dropHere')}
        </div>
      )}
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
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('chats.attach')}>
          {files.map((f) => (
            <li key={f.key} data-testid="pending-file" className={`flex max-w-full items-center gap-2 rounded-lg border px-2 py-1 text-xs ${f.status === 'error' ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50'}`}>
              <span className="min-w-0">
                <span className="block max-w-[14rem] truncate font-medium">{f.name}</span>
                <span className="block text-slate-500">{f.status === 'uploading' ? t('chats.uploading') : f.status === 'error' ? f.error : formatSize(f.size)}</span>
              </span>
              <button type="button" aria-label={`${t('chats.removeFile')}: ${f.name}`} className="min-h-8 min-w-8 rounded text-lg text-slate-500 hover:bg-slate-200" onClick={() => removeFile(f)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        {!editing && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              data-testid="file-input"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = ''; // the same file can be chosen again
              }}
            />
            <button
              type="button"
              aria-label={t('chats.attach')}
              onClick={() => picker.current?.click()}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
              </svg>
            </button>
          </>
        )}
        <textarea
          ref={ref}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          aria-label={t('chats.writeMessage')}
          placeholder={t('chats.writeMessage')}
          value={text}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="block max-h-40 min-h-11 w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-base focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || uploading || (!text.trim() && doneIds.length === 0)}
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
