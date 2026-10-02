import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  private parse(q: Record<string, string | undefined>, take?: number) {
    const date = (v?: string) => {
      if (!v) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('INVALID_DATE');
      return d;
    };
    // "to" is a calendar day and includes the whole day
    const to = date(q.to);
    if (to) to.setUTCDate(to.getUTCDate() + 1);
    return {
      actorId: q.actorId || undefined,
      action: q.action || undefined,
      entityType: q.entityType || undefined,
      entityId: q.entityId || undefined,
      from: date(q.from),
      to,
      take: take ?? (q.take ? Number(q.take) : undefined),
      skip: q.skip ? Number(q.skip) : undefined,
    };
  }

  @Get()
  async list(@Query() q: Record<string, string | undefined>) {
    const rows = await this.audit.list(this.parse(q));
    // BigInt is not JSON-serializable
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }

  /** The same filters as a spreadsheet-friendly CSV (UTF-8 with a mark so Excel reads Cyrillic), at most 5000 rows. */
  @Get('export')
  async export(@Query() q: Record<string, string | undefined>, @Res() res: Response) {
    const rows = await this.audit.list(this.parse(q, 5000), 5000);
    // a cell starting with = + - @ would be run as a formula by Excel
    const cell = (v: unknown) => {
      const t = v === null || v === undefined ? '' : String(v);
      const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = ['at,actor,action,entityType,entityId,ip', ...rows.map((r) => [r.at.toISOString(), r.actorId, r.action, r.entityType, r.entityId, r.ip].map(cell).join(','))];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit.csv"', 'Cache-Control': 'no-store' });
    res.send('\uFEFF' + lines.join('\r\n'));
  }
}
