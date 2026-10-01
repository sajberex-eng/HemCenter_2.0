import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query('actorId') actorId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const rows = await this.audit.list({
      actorId,
      entityType,
      entityId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
    // BigInt is not JSON-serializable
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}
