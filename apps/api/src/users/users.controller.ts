import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // The staff directory is visible to every signed-in employee.
  @Get()
  list(@Query('q') q?: string, @Query('departmentId') departmentId?: string, @Query('includeInactive') inactive?: string, @Req() req?: Request) {
    const isAdmin = (req!.user as User).roles.includes('ADMIN');
    return this.users.list({ q, departmentId, includeInactive: isAdmin && inactive === 'true' });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateUserDto, @Req() req: Request) {
    return this.users.create(dto, (req.user as User).id, req.ip);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Req() req: Request) {
    return this.users.update(id, dto, (req.user as User).id, req.ip);
  }

  @Post(':id/reset-access')
  @Roles('ADMIN')
  reset(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.users.resetAccess(id, (req.user as User).id, req.ip);
  }

  @Post(':id/reset-totp')
  @HttpCode(204)
  @Roles('ADMIN')
  async resetTotp(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.users.resetTotp(id, (req.user as User).id, req.ip);
  }
}
