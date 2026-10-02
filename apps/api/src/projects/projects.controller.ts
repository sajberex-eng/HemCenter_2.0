import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { DecisionsService } from './decisions.service';
import { WorkloadService } from './workload.service';
import { AnswerDecisionDto, CreateDecisionDto, CreateMilestoneDto, CreateProjectDto, CreateTaskDto, SetMemberDto, UpdateMilestoneDto, UpdateProjectDto, UpdateTaskDto } from './dto';

const me = (req: Request) => req.user as User;

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
    private readonly decisions: DecisionsService,
    private readonly workload: WorkloadService,
  ) {}

  // ---- projects ----
  @Post('projects')
  @Roles('ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER')
  create(@Body() dto: CreateProjectDto, @Req() req: Request) {
    return this.projects.create(me(req), dto, req.ip);
  }

  @Get('projects')
  list(@Req() req: Request) {
    return this.projects.list(me(req));
  }

  @Get('projects/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.projects.get(id, me(req));
  }

  @Patch('projects/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto, @Req() req: Request) {
    return this.projects.update(id, me(req), dto, req.ip);
  }

  @Put('projects/:id/members/:userId')
  setMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: SetMemberDto, @Req() req: Request) {
    return this.projects.setMember(id, me(req), userId, dto, req.ip);
  }

  @Delete('projects/:id/members/:userId')
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: Request) {
    return this.projects.removeMember(id, me(req), userId, req.ip);
  }

  @Post('projects/:id/milestones')
  addMilestone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateMilestoneDto, @Req() req: Request) {
    return this.projects.addMilestone(id, me(req), dto, req.ip);
  }

  @Patch('projects/:id/milestones/:mid')
  updateMilestone(@Param('id', ParseUUIDPipe) id: string, @Param('mid', ParseUUIDPipe) mid: string, @Body() dto: UpdateMilestoneDto, @Req() req: Request) {
    return this.projects.updateMilestone(id, mid, me(req), dto, req.ip);
  }

  @Delete('projects/:id/milestones/:mid')
  removeMilestone(@Param('id', ParseUUIDPipe) id: string, @Param('mid', ParseUUIDPipe) mid: string, @Req() req: Request) {
    return this.projects.removeMilestone(id, mid, me(req), req.ip);
  }

  // ---- tasks ----
  @Post('tasks')
  createTask(@Body() dto: CreateTaskDto, @Req() req: Request) {
    return this.tasks.create(me(req), dto, req.ip);
  }

  @Get('tasks')
  listTasks(@Req() req: Request, @Query('mine') mine?: string, @Query('projectId') projectId?: string, @Query('overdue') overdue?: string, @Query('status') status?: string) {
    return this.tasks.list(me(req), { mine: mine === '1', projectId: projectId && /^[0-9a-f-]{36}$/.test(projectId) ? projectId : undefined, overdue: overdue === '1', status });
  }

  @Get('tasks/:id')
  getTask(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tasks.get(id, me(req));
  }

  @Patch('tasks/:id')
  updateTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto, @Req() req: Request) {
    return this.tasks.update(id, me(req), dto, req.ip);
  }

  @Post('chats/:chatId/messages/:messageId/task')
  taskFromMessage(@Param('chatId', ParseUUIDPipe) chatId: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: CreateTaskDto, @Req() req: Request) {
    return this.tasks.createFromMessage(me(req), chatId, messageId, dto, req.ip);
  }

  // ---- decisions ----
  @Post('chats/:chatId/messages/:messageId/decision')
  decisionFromMessage(@Param('chatId', ParseUUIDPipe) chatId: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: CreateDecisionDto, @Req() req: Request) {
    return this.decisions.createFromMessage(me(req), chatId, messageId, dto, req.ip);
  }

  @Post('decisions/:id/answer')
  @HttpCode(200)
  answer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDecisionDto, @Req() req: Request) {
    return this.decisions.answer(me(req), id, dto, req.ip);
  }

  @Get('decisions/pending')
  pending(@Req() req: Request) {
    return this.decisions.pendingFor(me(req));
  }

  // ---- workload ----
  @Get('workload/me')
  myLoad(@Req() req: Request) {
    return this.workload.forUser(me(req).id);
  }

  @Get('workload/matrix')
  @Roles('ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER')
  matrix(@Req() req: Request) {
    return this.workload.matrix(me(req));
  }
}
