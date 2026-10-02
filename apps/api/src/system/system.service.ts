import { Injectable } from '@nestjs/common';
import { statfsSync } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';

/** Below this share of free disk space the administrator is warned; below the second one it is an alarm. */
export const DISK_WARN_FREE = 0.2;
export const DISK_ALARM_FREE = 0.1;

export type Level = 'ok' | 'warn' | 'alarm';
export const diskLevel = (freeShare: number): Level => (freeShare < DISK_ALARM_FREE ? 'alarm' : freeShare < DISK_WARN_FREE ? 'warn' : 'ok');

export interface SystemStatus {
  checkedAt: string;
  uptimeSeconds: number;
  database: { ok: boolean; latencyMs: number | null; sizeBytes: number | null };
  disk: { level: Level; totalBytes: number; freeBytes: number; freeShare: number; path: string } | null;
  files: { count: number; bytes: number };
  push: { enabled: boolean; devices: number };
  users: { active: number; locked: number };
  scheduler: boolean;
}

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** What the administrator needs to know at a glance: is it alive, is there room on the disk, are phones registered for push. */
  async status(): Promise<SystemStatus> {
    const t0 = performance.now();
    let dbOk = true;
    let size: number | null = null;
    try {
      const [row] = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
      size = Number(row.size);
    } catch {
      dbOk = false;
    }
    const latency = dbOk ? Math.round(performance.now() - t0) : null;

    let disk: SystemStatus['disk'] = null;
    const dir = path.resolve(process.env.FILES_DIR ?? './data/files');
    try {
      const s = statfsSync(dir);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      disk = { level: diskLevel(total ? free / total : 1), totalBytes: total, freeBytes: free, freeShare: total ? free / total : 1, path: dir };
    } catch {
      /* the directory does not exist yet */
    }

    const [files, devices, active, locked] = dbOk
      ? await Promise.all([
          this.prisma.attachment.aggregate({ where: { deletedAt: null }, _count: true, _sum: { size: true } }),
          this.prisma.pushSubscription.count(),
          this.prisma.user.count({ where: { isActive: true, isExternal: false } }),
          this.prisma.user.count({ where: { lockedUntil: { gt: new Date() } } }),
        ])
      : [{ _count: 0, _sum: { size: 0 } }, 0, 0, 0];

    return {
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      database: { ok: dbOk, latencyMs: latency, sizeBytes: size },
      disk,
      files: { count: files._count, bytes: files._sum.size ?? 0 },
      push: { enabled: this.push.enabled, devices },
      users: { active, locked },
      scheduler: process.env.DISABLE_SCHEDULER !== 'true',
    };
  }
}
