'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorText, PageTitle, useErrorText } from '@/components/ui';

interface Status {
  checkedAt: string;
  uptimeSeconds: number;
  database: { ok: boolean; latencyMs: number | null; sizeBytes: number | null };
  disk: { level: 'ok' | 'warn' | 'alarm'; totalBytes: number; freeBytes: number; freeShare: number } | null;
  files: { count: number; bytes: number };
  push: { enabled: boolean; devices: number };
  users: { active: number; locked: number };
  scheduler: boolean;
}

const size = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const uptime = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);

export default function SystemPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [s, setS] = useState<Status>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => api<Status>('/system/status').then((x) => { setS(x); setError(undefined); }, (e) => setError(errorText(e))), [errorText]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const row = (label: string, value: string, testId: string, bad?: boolean) => (
    <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-2 first:border-0" data-testid={testId}>
      <dt className="text-slate-600">{label}</dt>
      <dd className={`font-medium ${bad ? 'text-red-700' : ''}`}>{value}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{t('sys.title')}</PageTitle>
        <Button variant="secondary" onClick={() => void load()}>{t('sys.refresh')}</Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {s && (
        <>
          {s.disk && s.disk.level !== 'ok' && (
            <p role="alert" data-testid="disk-warning" className={`rounded-lg border px-3 py-2 text-sm ${s.disk.level === 'alarm' ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              {s.disk.level === 'alarm' ? t('sys.diskAlarm') : t('sys.diskWarn')}
            </p>
          )}
          <Card>
            <dl className="text-sm">
              {row(t('sys.db'), s.database.ok ? t('sys.dbOk', { ms: s.database.latencyMs ?? 0 }) : t('sys.dbDown'), 'sys-db', !s.database.ok)}
              {s.database.sizeBytes !== null && row('', t('sys.dbSize', { size: size(s.database.sizeBytes) }), 'sys-db-size')}
              {s.disk && row(t('sys.disk'), t('sys.diskFree', { free: size(s.disk.freeBytes), total: size(s.disk.totalBytes), percent: Math.round(s.disk.freeShare * 100) }), 'sys-disk', s.disk.level !== 'ok')}
              {row(t('sys.files'), t('sys.filesValue', { n: s.files.count, size: size(s.files.bytes) }), 'sys-files')}
              {row(t('sys.push'), s.push.enabled ? t('sys.pushOn', { n: s.push.devices }) : t('sys.pushOff'), 'sys-push', !s.push.enabled)}
              {row(t('sys.users'), t('sys.usersValue', { n: s.users.active, locked: s.users.locked }), 'sys-users')}
              {row(t('sys.scheduler'), s.scheduler ? t('sys.on') : t('sys.off'), 'sys-scheduler', !s.scheduler)}
              {row(t('sys.uptime'), uptime(s.uptimeSeconds), 'sys-uptime')}
            </dl>
          </Card>
          <p className="text-sm text-slate-600">{t('sys.hint')}</p>
        </>
      )}
    </div>
  );
}
