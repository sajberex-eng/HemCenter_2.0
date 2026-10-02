import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { GROUP_MAX_MEMBERS } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { dateOnly, isOverdue, parseDate, totalLoad, isOverloaded } from './project-rules';
import type { CreateMilestoneDto, CreateProjectDto, SetMemberDto, UpdateMilestoneDto, UpdateProjectDto } from './dto';

const FULL = {
  members: { include: { user: { select: { fullName: true } } }, orderBy: { joinedAt: 'asc' } },
  milestones: { orderBy: { dueDate: 'asc' } },
} satisfies Prisma.ProjectInclude;
type ProjectFull = Prisma.ProjectGetPayload<{ include: typeof FULL }>;

/** Roles that see and manage every project. */
const OVERSEERS = ['ADMIN', 'MANAGEMENT'] as const;
export const isOverseer = (u: Pick<User, 'roles'>) => u.roles.some((r) => (OVERSEERS as readonly string[]).includes(r));

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---- access -----------------------------------------------------------------------------------------------

  private canView(p: ProjectFull, u: User) {
    return isOverseer(u) || p.managerId === u.id || p.curatorId === u.id || p.members.some((m) => m.userId === u.id);
  }

  canManage(p: { managerId: string }, u: Pick<User, 'id' | 'roles'>) {
    return isOverseer(u) || p.managerId === u.id;
  }

  /** The project for someone allowed to see it; everybody else is told it does not exist. */
  private async load(id: string, u: User): Promise<ProjectFull> {
    const p = await this.prisma.project.findUnique({ where: { id }, include: FULL });
    if (!p || !this.canView(p, u)) throw new NotFoundException('PROJECT_NOT_FOUND');
    return p;
  }

  private async loadManaged(id: string, u: User) {
    const p = await this.load(id, u);
    if (!this.canManage(p, u)) throw new ForbiddenException('FORBIDDEN');
    return p;
  }

  private async assertActiveUsers(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.user.count({ where: { id: { in: unique }, isActive: true, isExternal: false } });
    if (found !== unique.length) throw new BadRequestException('USER_NOT_FOUND');
  }

  private dates(start?: string | null, end?: string | null) {
    const s = start === undefined ? undefined : start === null ? null : parseDate(start);
    const e = end === undefined ? undefined : end === null ? null : parseDate(end);
    if (s === null && start) throw new BadRequestException('INVALID_DATE');
    if (e === null && end) throw new BadRequestException('INVALID_DATE');
    return { s, e };
  }

  // ---- mapping ----------------------------------------------------------------------------------------------

  private async toDto(p: ProjectFull) {
    const ids = p.members.map((m) => m.userId);
    const loads = await this.loadsOf(ids);
    return {
      id: p.id,
      name: p.name,
      goal: p.goal,
      status: p.status,
      startDate: dateOnly(p.startDate),
      endDate: dateOnly(p.endDate),
      managerId: p.managerId,
      curatorId: p.curatorId,
      chatId: p.chatId,
      members: p.members.map((m) => ({
        userId: m.userId,
        fullName: m.user.fullName,
        allocation: m.allocation,
        roleTitle: m.roleTitle,
        // the person's total over all running projects, so an overload is visible right where it is caused
        totalLoad: loads.get(m.userId) ?? 0,
        overloaded: isOverloaded(loads.get(m.userId) ?? 0),
      })),
      milestones: p.milestones.map((x) => ({
        id: x.id,
        title: x.title,
        dueDate: dateOnly(x.dueDate)!,
        doneAt: x.doneAt?.toISOString() ?? null,
        overdue: isOverdue(x.dueDate, x.doneAt !== null),
      })),
      createdAt: p.createdAt.toISOString(),
    };
  }

  /** Total allocation per person over planned and running projects. */
  async loadsOf(userIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.projectMember.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, allocation: true, project: { select: { status: true } } },
    });
    const out = new Map<string, number>();
    for (const id of userIds) out.set(id, totalLoad(rows.filter((r) => r.userId === id).map((r) => ({ allocation: r.allocation, projectStatus: r.project.status }))));
    return out;
  }

  // ---- projects ---------------------------------------------------------------------------------------------

  async create(actor: User, dto: CreateProjectDto, ip?: string) {
    const managerId = dto.managerId ?? actor.id;
    const team = new Map<string, { allocation: number; roleTitle?: string }>();
    for (const m of dto.members ?? []) team.set(m.userId, { allocation: m.allocation, roleTitle: m.roleTitle });
    if (!team.has(managerId)) team.set(managerId, { allocation: 0, roleTitle: undefined });
    if (dto.curatorId && !team.has(dto.curatorId)) team.set(dto.curatorId, { allocation: 0, roleTitle: undefined });
    if (team.size > GROUP_MAX_MEMBERS) throw new BadRequestException('GROUP_TOO_LARGE');
    await this.assertActiveUsers([...team.keys()]);
    const { s, e } = this.dates(dto.startDate, dto.endDate);
    if (s && e && e < s) throw new BadRequestException('INVALID_DATE_RANGE');

    const project = await this.prisma.$transaction(async (tx) => {
      const chat = await tx.chat.create({
        data: {
          type: 'GROUP',
          title: dto.name.trim(),
          createdById: managerId,
          members: { create: [...team.keys()].map((id) => ({ userId: id, role: id === managerId ? ('OWNER' as const) : ('MEMBER' as const) })) },
        },
      });
      return tx.project.create({
        data: {
          name: dto.name.trim(),
          goal: dto.goal?.trim() || null,
          startDate: s ?? null,
          endDate: e ?? null,
          managerId,
          curatorId: dto.curatorId ?? null,
          chatId: chat.id,
          members: { create: [...team].map(([userId, v]) => ({ userId, allocation: v.allocation, roleTitle: v.roleTitle?.trim() || null })) },
        },
        include: FULL,
      });
    });
    await this.audit.log({ actorId: actor.id, action: 'project.created', entityType: 'Project', entityId: project.id, data: { name: project.name, managerId, members: [...team.keys()] }, ip });
    this.realtime.emit([...team.keys()], 'chat:updated', { chatId: project.chatId });
    return this.toDto(project);
  }

  async list(u: User) {
    const where: Prisma.ProjectWhereInput = isOverseer(u) ? {} : { OR: [{ managerId: u.id }, { curatorId: u.id }, { members: { some: { userId: u.id } } }] };
    const rows = await this.prisma.project.findMany({ where, include: FULL, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
    return Promise.all(rows.map((p) => this.toDto(p)));
  }

  async get(id: string, u: User) {
    return this.toDto(await this.load(id, u));
  }

  async update(id: string, actor: User, dto: UpdateProjectDto, ip?: string) {
    const p = await this.loadManaged(id, actor);
    const { s, e } = this.dates(dto.startDate, dto.endDate);
    const start = s === undefined ? p.startDate : s;
    const end = e === undefined ? p.endDate : e;
    if (start && end && end < start) throw new BadRequestException('INVALID_DATE_RANGE');

    const data: Prisma.ProjectUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.goal !== undefined) data.goal = dto.goal.trim() || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (s !== undefined) data.startDate = s;
    if (e !== undefined) data.endDate = e;
    if (dto.curatorId !== undefined) data.curatorId = dto.curatorId;

    const newManager = dto.managerId && dto.managerId !== p.managerId ? dto.managerId : null;
    const extra = [newManager, dto.curatorId].filter((x): x is string => !!x);
    if (extra.length) await this.assertActiveUsers(extra);
    await this.prisma.$transaction(async (tx) => {
      // a manager or curator is always part of the team (and so of the project chat)
      for (const uid of extra) {
        await tx.projectMember.upsert({ where: { projectId_userId: { projectId: id, userId: uid } }, update: {}, create: { projectId: id, userId: uid, allocation: 0 } });
        await tx.chatMember.upsert({ where: { chatId_userId: { chatId: p.chatId, userId: uid } }, update: {}, create: { chatId: p.chatId, userId: uid } });
      }
      if (newManager) {
        data.managerId = newManager;
        await tx.chatMember.updateMany({ where: { chatId: p.chatId, role: 'OWNER' }, data: { role: 'MEMBER' } });
        await tx.chatMember.update({ where: { chatId_userId: { chatId: p.chatId, userId: newManager } }, data: { role: 'OWNER' } });
      }
      if (dto.name !== undefined) await tx.chat.update({ where: { id: p.chatId }, data: { title: dto.name.trim() } });
      await tx.project.update({ where: { id }, data });
    });
    await this.audit.log({ actorId: actor.id, action: 'project.updated', entityType: 'Project', entityId: id, data: JSON.parse(JSON.stringify(dto)), ip });
    await this.syncChat(p.chatId);
    return this.get(id, actor);
  }

  private async syncChat(chatId: string) {
    const members = await this.prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
    this.realtime.emit(members.map((m) => m.userId), 'chat:updated', { chatId });
  }

  // ---- team -------------------------------------------------------------------------------------------------

  async setMember(id: string, actor: User, userId: string, dto: SetMemberDto, ip?: string) {
    const p = await this.loadManaged(id, actor);
    await this.assertActiveUsers([userId]);
    if (!p.members.some((m) => m.userId === userId) && p.members.length >= GROUP_MAX_MEMBERS) throw new BadRequestException('GROUP_TOO_LARGE');
    const chat = await this.prisma.chat.findUniqueOrThrow({ where: { id: p.chatId }, select: { lastSeq: true } });
    await this.prisma.$transaction([
      this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: id, userId } },
        update: { allocation: dto.allocation, ...(dto.roleTitle !== undefined ? { roleTitle: dto.roleTitle.trim() || null } : {}) },
        create: { projectId: id, userId, allocation: dto.allocation, roleTitle: dto.roleTitle?.trim() || null },
      }),
      // newcomers start with the history marked read, as in any group
      this.prisma.chatMember.upsert({ where: { chatId_userId: { chatId: p.chatId, userId } }, update: {}, create: { chatId: p.chatId, userId, lastReadSeq: chat.lastSeq } }),
    ]);
    await this.audit.log({ actorId: actor.id, action: 'project.member_set', entityType: 'Project', entityId: id, data: { userId, allocation: dto.allocation, roleTitle: dto.roleTitle }, ip });
    await this.syncChat(p.chatId);
    return this.get(id, actor);
  }

  async removeMember(id: string, actor: User, userId: string, ip?: string) {
    const p = await this.loadManaged(id, actor);
    if (!p.members.some((m) => m.userId === userId)) throw new NotFoundException('USER_NOT_FOUND');
    if (userId === p.managerId || userId === p.curatorId) throw new BadRequestException('CANNOT_REMOVE_MANAGER');
    // an unfinished task must not be left with someone who is no longer on the team
    const open = await this.prisma.task.count({ where: { projectId: id, assigneeId: userId, status: { not: 'DONE' } } });
    if (open > 0) throw new BadRequestException('MEMBER_HAS_OPEN_TASKS');
    await this.prisma.$transaction([
      this.prisma.projectMember.delete({ where: { projectId_userId: { projectId: id, userId } } }),
      this.prisma.chatMember.deleteMany({ where: { chatId: p.chatId, userId } }),
    ]);
    await this.audit.log({ actorId: actor.id, action: 'project.member_removed', entityType: 'Project', entityId: id, data: { userId }, ip });
    this.realtime.emit([userId], 'chat:updated', { chatId: p.chatId });
    await this.syncChat(p.chatId);
    return this.get(id, actor);
  }

  // ---- milestones -------------------------------------------------------------------------------------------

  async addMilestone(id: string, actor: User, dto: CreateMilestoneDto, ip?: string) {
    await this.loadManaged(id, actor);
    const due = parseDate(dto.dueDate);
    if (!due) throw new BadRequestException('INVALID_DATE');
    const m = await this.prisma.milestone.create({ data: { projectId: id, title: dto.title.trim(), dueDate: due } });
    await this.audit.log({ actorId: actor.id, action: 'milestone.created', entityType: 'Milestone', entityId: m.id, data: { projectId: id, title: m.title, dueDate: dto.dueDate }, ip });
    return this.get(id, actor);
  }

  async updateMilestone(id: string, milestoneId: string, actor: User, dto: UpdateMilestoneDto, ip?: string) {
    await this.loadManaged(id, actor);
    const found = await this.prisma.milestone.findFirst({ where: { id: milestoneId, projectId: id } });
    if (!found) throw new NotFoundException('MILESTONE_NOT_FOUND');
    const data: Prisma.MilestoneUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.dueDate !== undefined) {
      const due = parseDate(dto.dueDate);
      if (!due) throw new BadRequestException('INVALID_DATE');
      data.dueDate = due;
    }
    if (dto.done !== undefined) data.doneAt = dto.done ? (found.doneAt ?? new Date()) : null;
    await this.prisma.milestone.update({ where: { id: milestoneId }, data });
    await this.audit.log({ actorId: actor.id, action: 'milestone.updated', entityType: 'Milestone', entityId: milestoneId, data: JSON.parse(JSON.stringify(dto)), ip });
    return this.get(id, actor);
  }

  async removeMilestone(id: string, milestoneId: string, actor: User, ip?: string) {
    await this.loadManaged(id, actor);
    const done = await this.prisma.milestone.deleteMany({ where: { id: milestoneId, projectId: id } });
    if (done.count === 0) throw new NotFoundException('MILESTONE_NOT_FOUND');
    await this.audit.log({ actorId: actor.id, action: 'milestone.deleted', entityType: 'Milestone', entityId: milestoneId, data: { projectId: id }, ip });
    return this.get(id, actor);
  }
}
