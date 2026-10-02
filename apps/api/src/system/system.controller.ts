import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { SystemService } from './system.service';

@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('status')
  status() {
    return this.system.status();
  }
}
