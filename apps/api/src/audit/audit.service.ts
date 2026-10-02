import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  data?: Prisma.InputJsonValue;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        data: entry.data,
        ip: entry.ip,
      },
    });
  }

  /**
   * Rows for the administrator's screen and export. The `data` column (which holds, for example, the previous text
   * of an edited message) is never returned here: the log shows WHO did WHAT and WHEN, not private content. The text
   * stays recoverable at database level for a legal request.
   */
  list(params: { actorId?: string; action?: string; entityType?: string; entityId?: string; from?: Date; to?: Date; take?: number; skip?: number }, maxTake = 200) {
    return this.prisma.auditLog.findMany({
      where: {
        actorId: params.actorId,
        action: params.action ? { startsWith: params.action } : undefined,
        entityType: params.entityType,
        entityId: params.entityId,
        at: params.from || params.to ? { gte: params.from, lt: params.to } : undefined,
      },
      select: { id: true, at: true, actorId: true, action: true, entityType: true, entityId: true, ip: true },
      orderBy: { id: 'desc' },
      take: Math.min(Number.isFinite(params.take) ? params.take! : 50, maxTake),
      skip: params.skip ?? 0,
    });
  }
}
