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

  list(params: { actorId?: string; entityType?: string; entityId?: string; take?: number; skip?: number }) {
    return this.prisma.auditLog.findMany({
      where: {
        actorId: params.actorId,
        entityType: params.entityType,
        entityId: params.entityId,
      },
      orderBy: { id: 'desc' },
      take: Math.min(params.take ?? 50, 200),
      skip: params.skip ?? 0,
    });
  }
}
