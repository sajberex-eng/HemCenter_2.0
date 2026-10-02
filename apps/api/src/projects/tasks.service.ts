import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Task, User } from '@prisma/client';
import type { TaskDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChatsService } from '../chats/chats.service';
import { MessagesService } from '../chats/messages.service';
import { toTaskCard } from '../chats/mappers';
import { dateOnly, parseDate } from './project-rules';
import { isOverseer } from './projects.service';
import type { CreateTaskDto, UpdateTaskDto } from './dto';

export const toTaskDto = (t: Task): TaskDto => ({
  ...toTaskCard(t),
  description: t.description,
  coAssigneeIds: t.coAssigneeIds,
  projectId: t.projectId,
  createdById: t.createdById,
  sourceChatId: t.sourceChatId,
  sourceMessageId: t.sourceMessageId,
  createdAt: t.createdAt.toISOString(),
});

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly chats: ChatsService,
    private readonly messages: MessagesService,
  ) {}

  private due(v?: string) {
    if (v === undefined) return undefined;
    const d = parseDate(v);
    if (!d) throw new BadRequestException('INVALID_DATE');
    return d;
  }

  private async projectMemberIds(projectId: string) {
    const rows = await this.prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  private assertAll(ids: string[], allowed: string[], code: string) {
    if (ids.some((id) => !allowed.includes(id))) throw new BadRequestException(code);
  }

  /** A task made from a chat message. In a project chat it belongs to that project automatically. */
  async createFromMessage(actor: User, chatId: string, messageId: string, dto: CreateTaskDto, ip?: string) {
    const { chat } = await this.chats.requireMember(chatId, actor.id);
    ChatsService.assertWritable(chat);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, chatId } });
    if (!message) throw new NotFoundException('MESSAGE_NOT_FOUND');
    if (message.deletedAt) throw new BadRequestException('MESSAGE_DELETED');
    const memberIds = chat.members.map((m) => m.userId);
    const coIds = [...new Set(dto.coAssigneeIds ?? [])].filter((id) => id !== dto.assigneeId);
    this.assertAll([dto.assigneeId, ...coIds], memberIds, 'ASSIGNEE_NOT_IN_CHAT');
    const assignee = await this.prisma.user.findFirst({ where: { id: dto.assigneeId, isActive: true } });
    if (!assignee) throw new BadRequestException('USER_NOT_FOUND');
    const project = await this.prisma.project.findUnique({ where: { chatId }, select: { id: true } });

    const task = await this.prisma.task.create({
      data: {
        projectId: project?.id ?? null,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        assigneeId: dto.assigneeId,
        coAssigneeIds: coIds,
        dueDate: this.due(dto.dueDate) ?? null,
        createdById: actor.id,
        sourceChatId: chatId,
        sourceMessageId: messageId,
      },
    });
    await this.audit.log({ actorId: actor.id, action: 'task.created', entityType: 'Task', entityId: task.id, data: { chatId, messageId, assigneeId: task.assigneeId, projectId: task.projectId }, ip });
    await this.messages.broadcastUpdate(messageId);
    return toTaskDto(task);
  }

  /** A task made without a message: inside a project, or a personal one (only overseers may hand out tasks freely). */
  async create(actor: User, dto: CreateTaskDto, ip?: string) {
    let projectId: string | null = null;
    const coIds = [...new Set(dto.coAssigneeIds ?? [])].filter((id) => id !== dto.assigneeId);
    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, include: { members: { select: { userId: true } } } });
      const team = project?.members.map((m) => m.userId) ?? [];
      if (!project || !(isOverseer(actor) || project.managerId === actor.id || team.includes(actor.id))) throw new NotFoundException('PROJECT_NOT_FOUND');
      this.assertAll([dto.assigneeId, ...coIds], team, 'ASSIGNEE_NOT_IN_PROJECT');
      projectId = project.id;
    } else {
      if (dto.assigneeId !== actor.id && !isOverseer(actor)) throw new ForbiddenException('FORBIDDEN');
      const ids = [dto.assigneeId, ...coIds];
      if ((await this.prisma.user.count({ where: { id: { in: ids }, isActive: true } })) !== ids.length) throw new BadRequestException('USER_NOT_FOUND');
    }
    const task = await this.prisma.task.create({
      data: {
        projectId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        assigneeId: dto.assigneeId,
        coAssigneeIds: coIds,
        dueDate: this.due(dto.dueDate) ?? null,
        createdById: actor.id,
      },
    });
    await this.audit.log({ actorId: actor.id, action: 'task.created', entityType: 'Task', entityId: task.id, data: { assigneeId: task.assigneeId, projectId }, ip });
    return toTaskDto(task);
  }

  private async loadVisible(id: string, actor: User) {
    const t = await this.prisma.task.findUnique({ where: { id }, include: { project: { select: { managerId: true } } } });
    if (!t) throw new NotFoundException('TASK_NOT_FOUND');
    const involved = t.assigneeId === actor.id || t.coAssigneeIds.includes(actor.id) || t.createdById === actor.id || isOverseer(actor) || t.project?.managerId === actor.id;
    const onTeam = !involved && t.projectId ? (await this.prisma.projectMember.count({ where: { projectId: t.projectId, userId: actor.id } })) > 0 : false;
    if (!involved && !onTeam) throw new NotFoundException('TASK_NOT_FOUND');
    return { task: t, canEdit: t.createdById === actor.id || isOverseer(actor) || t.project?.managerId === actor.id };
  }

  async get(id: string, actor: User) {
    return toTaskDto((await this.loadVisible(id, actor)).task);
  }

  async update(id: string, actor: User, dto: UpdateTaskDto, ip?: string) {
    const { task, canEdit } = await this.loadVisible(id, actor);
    const isAssignee = task.assigneeId === actor.id;
    // (class fields can exist with value undefined, so look at the values)
    const onlyStatus = Object.entries(dto).every(([k, v]) => v === undefined || k === 'status');
    // the person responsible may report progress; changing the task itself is for whoever set it
    if (!canEdit && !(isAssignee && onlyStatus)) throw new ForbiddenException('FORBIDDEN');

    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    if (dto.dueDate !== undefined) data.dueDate = this.due(dto.dueDate);
    if (dto.assigneeId !== undefined || dto.coAssigneeIds !== undefined) {
      const assigneeId = dto.assigneeId ?? task.assigneeId;
      const coIds = [...new Set(dto.coAssigneeIds ?? task.coAssigneeIds)].filter((x) => x !== assigneeId);
      const pool = task.projectId
        ? await this.projectMemberIds(task.projectId)
        : task.sourceChatId
          ? (await this.prisma.chatMember.findMany({ where: { chatId: task.sourceChatId }, select: { userId: true } })).map((m) => m.userId)
          : [task.createdById, assigneeId];
      this.assertAll([assigneeId, ...coIds], pool, task.projectId ? 'ASSIGNEE_NOT_IN_PROJECT' : 'ASSIGNEE_NOT_IN_CHAT');
      data.assigneeId = assigneeId;
      data.coAssigneeIds = coIds;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.doneAt = dto.status === 'DONE' ? (task.doneAt ?? new Date()) : null;
    }
    const updated = await this.prisma.task.update({ where: { id }, data });
    await this.audit.log({ actorId: actor.id, action: 'task.updated', entityType: 'Task', entityId: id, data: { ...JSON.parse(JSON.stringify(dto)), previousAssigneeId: task.assigneeId, previousStatus: task.status }, ip });
    if (updated.sourceMessageId) await this.messages.broadcastUpdate(updated.sourceMessageId);
    return toTaskDto(updated);
  }

  /** mine: I am responsible or a co-assignee. Otherwise everything the person is allowed to see. */
  async list(actor: User, q: { mine?: boolean; projectId?: string; overdue?: boolean; status?: string }) {
    const and: Prisma.TaskWhereInput[] = [];
    if (q.mine) and.push({ OR: [{ assigneeId: actor.id }, { coAssigneeIds: { has: actor.id } }] });
    else if (!isOverseer(actor)) {
      and.push({ OR: [{ assigneeId: actor.id }, { coAssigneeIds: { has: actor.id } }, { createdById: actor.id }, { project: { OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] } }] });
    }
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.status === 'open') and.push({ status: { not: 'DONE' } });
    const rows = await this.prisma.task.findMany({ where: { AND: and }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 300 });
    const dtos = rows.map(toTaskDto);
    return q.overdue ? dtos.filter((t) => t.overdue) : dtos;
  }
}
