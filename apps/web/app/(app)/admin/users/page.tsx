'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLES, LOCALES, type Locale, type Role, type UserDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/useOrg';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';

interface InviteResult {
  user: UserDto;
  inviteToken: string;
  inviteDays: number;
}

const emptyForm = { login: '', fullName: '', phone: '', email: '', roles: ['EMPLOYEE'] as Role[], locale: 'ru' as Locale, departmentId: '', positionId: '' };

export default function UsersPage() {
  const { t } = useI18n();
  const { user: me } = useAuth();
  const org = useOrg();
  const errorText = useErrorText();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string>();
  const [invite, setInvite] = useState<{ token: string; days: number; name: string }>();
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api<UserDto[]>(`/users?includeInactive=${showInactive}`).then(setUsers).catch((e) => setError(errorText(e)));
    // errorText is recreated each render; only the filter should retrigger loading
  }, [showInactive]);

  useEffect(load, [load]);

  const inviteUrl = (token: string) => `${window.location.origin}/invite?token=${token}`;

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      const body = {
        login: form.login.trim(),
        fullName: form.fullName.trim(),
        roles: form.roles,
        locale: form.locale,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        departmentId: form.departmentId || undefined,
        positionId: form.positionId || undefined,
      };
      const res = await api<InviteResult>('/users', { method: 'POST', body });
      setInvite({ token: res.inviteToken, days: res.inviteDays, name: res.user.fullName });
      setAdding(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function patch(u: UserDto, body: Partial<UserDto>) {
    setError(undefined);
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function resetAccess(u: UserDto) {
    if (!confirm(t('users.confirmReset'))) return;
    setError(undefined);
    try {
      const res = await api<{ inviteToken: string; inviteDays: number }>(`/users/${u.id}/reset-access`, { method: 'POST' });
      setInvite({ token: res.inviteToken, days: res.inviteDays, name: u.fullName });
    } catch (err) {
      setError(errorText(err));
    }
  }

  function toggleRole(r: Role) {
    setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{t('users.title')}</PageTitle>
        <Button onClick={() => setAdding((v) => !v)}>{t('users.add')}</Button>
      </div>
      <ErrorText>{error}</ErrorText>

      {invite && (
        <Card className="border-teal-300 bg-teal-50">
          <h2 className="font-medium">{t('users.inviteTitle')} — {invite.name}</h2>
          <p className="my-2 text-sm text-slate-700">{t('users.inviteText', { days: invite.days })}</p>
          <code className="block break-all rounded bg-white p-2 text-sm">{inviteUrl(invite.token)}</code>
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl(invite.token));
                setCopied(true);
              }}
            >
              {copied ? t('copied') : t('copy')}
            </Button>
            <Button variant="secondary" onClick={() => { setInvite(undefined); setCopied(false); }}>
              {t('cancel')}
            </Button>
          </div>
        </Card>
      )}

      {adding && (
        <Card>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label={t('field.fullName')}>
              <Input required minLength={2} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label={t('field.login')}>
              <Input required minLength={3} pattern="[A-Za-z0-9._\-]+" autoCapitalize="none" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
            </Field>
            <Field label={t('field.phone')}>
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label={t('field.email')}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={t('field.department')}>
              <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">{t('none')}</option>
                {org.departments.map((d) => <option key={d.id} value={d.id}>{org.name(d)}</option>)}
              </Select>
            </Field>
            <Field label={t('field.position')}>
              <Select value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
                <option value="">{t('none')}</option>
                {org.positions.map((p) => <option key={p.id} value={p.id}>{org.name(p)}</option>)}
              </Select>
            </Field>
            <Field label={t('field.language')}>
              <Select value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value as Locale })}>
                {LOCALES.map((l) => <option key={l} value={l}>{l === 'ru' ? 'Русский' : 'Қазақша'}</option>)}
              </Select>
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">{t('field.roles')}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-5" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} />
                    {t(`role.${r}` as Key)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={form.roles.length === 0}>{t('create')}</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>{t('cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        {t('users.showInactive')}
      </label>

      <div className="space-y-3">
        {users.map((u) => (
          <Card key={u.id} className={u.isActive ? '' : 'opacity-70'}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{u.fullName} <span className="text-sm font-normal text-slate-500">@{u.login}</span></div>
                <div className="text-sm text-slate-600">
                  {[org.position(u.positionId), org.department(u.departmentId)].filter(Boolean).join(' · ') || t('none')}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {u.roles.map((r) => <span key={r} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t(`role.${r}` as Key)}</span>)}
                  {!u.isActive && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">{t('status.inactive')}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => resetAccess(u)}>{t('users.resetAccess')}</Button>
                {u.id !== me?.id && (
                  <Button variant={u.isActive ? 'danger' : 'secondary'} onClick={() => patch(u, { isActive: !u.isActive })}>
                    {u.isActive ? t('users.deactivate') : t('users.activate')}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
