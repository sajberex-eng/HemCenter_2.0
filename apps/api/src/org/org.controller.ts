import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

class NameDto {
  @IsString() @MinLength(2) @MaxLength(200) nameRu: string;
  @IsString() @MinLength(2) @MaxLength(200) nameKk: string;
}
class DepartmentDto extends NameDto {
  @IsOptional() @IsUUID() parentId?: string | null;
}
class PatchNameDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) nameRu?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) nameKk?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrgController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get('departments')
  departments() {
    return this.prisma.department.findMany({ orderBy: { nameRu: 'asc' } });
  }

  @Post('departments')
  @Roles('ADMIN')
  async createDepartment(@Body() dto: DepartmentDto, @Req() req: Request) {
    const d = await this.prisma.department.create({ data: dto });
    await this.audit.log({ actorId: (req.user as User).id, action: 'department.created', entityType: 'Department', entityId: d.id, ip: req.ip });
    return d;
  }

  @Patch('departments/:id')
  @Roles('ADMIN')
  async updateDepartment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchNameDto, @Req() req: Request) {
    if (dto.parentId === id) dto.parentId = null; // a department cannot be its own parent
    const d = await this.prisma.department.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: (req.user as User).id, action: 'department.updated', entityType: 'Department', entityId: id, ip: req.ip });
    return d;
  }

  @Delete('departments/:id')
  @HttpCode(204)
  @Roles('ADMIN')
  async deleteDepartment(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { departmentId: id }, data: { departmentId: null } }),
      this.prisma.department.updateMany({ where: { parentId: id }, data: { parentId: null } }),
      this.prisma.department.delete({ where: { id } }),
    ]);
    await this.audit.log({ actorId: (req.user as User).id, action: 'department.deleted', entityType: 'Department', entityId: id, ip: req.ip });
  }

  @Get('positions')
  positions() {
    return this.prisma.position.findMany({ orderBy: { nameRu: 'asc' } });
  }

  @Post('positions')
  @Roles('ADMIN')
  async createPosition(@Body() dto: NameDto, @Req() req: Request) {
    const p = await this.prisma.position.create({ data: dto });
    await this.audit.log({ actorId: (req.user as User).id, action: 'position.created', entityType: 'Position', entityId: p.id, ip: req.ip });
    return p;
  }

  @Patch('positions/:id')
  @Roles('ADMIN')
  async updatePosition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchNameDto, @Req() req: Request) {
    const { nameRu, nameKk } = dto;
    const p = await this.prisma.position.update({ where: { id }, data: { nameRu, nameKk } });
    await this.audit.log({ actorId: (req.user as User).id, action: 'position.updated', entityType: 'Position', entityId: id, ip: req.ip });
    return p;
  }

  @Delete('positions/:id')
  @HttpCode(204)
  @Roles('ADMIN')
  async deletePosition(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { positionId: id }, data: { positionId: null } }),
      this.prisma.position.delete({ where: { id } }),
    ]);
    await this.audit.log({ actorId: (req.user as User).id, action: 'position.deleted', entityType: 'Position', entityId: id, ip: req.ip });
  }
}
