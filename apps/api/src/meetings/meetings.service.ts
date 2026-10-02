import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { EDITABLE_DOCUMENT_STATUSES, GROUP_MAX_MEMBERS, type MeetingDto, type MeetingResolutionDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DocumentsService, seesAllDocuments } from '../documents/documents.service';
import { KindsTemplatesService } from '../documents/kinds-templates.service';
import { dateOnly, decisionStatus, parseDate } from '../projects/project-rules';
import { isOverseer } from '../projects/projects.service';
import { protocolData, protocolTitle } from './meeting-rules';
import type { CreateMeetingDto, ItemDto, ProtocolDto, ResolutionDto, UpdateItemDto, UpdateMeetingDto, UpdateResolutionDto } from './dto';

const FULL = {
  items: { orderBy: { position: 'asc' }, include: { resolutions: { orderBy: { position: 'asc' } } } },
  protocol: { select: { id: true, status: true } },
} satisfies Prisma.MeetingInclude;
type MeetingFull = Prisma.MeetingGetPayload<{ include: typeof FULL }>;

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly documents: DocumentsService,
    private readonly kinds: KindsTemplatesService,
  ) {}

  // ---- access ----
  private async memberIds(chatId: string) {
    return (await this.prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } })).map((m) => m.userId);
  }

  private canEdit(m: Pick<MeetingFull, 'createdById' | 'chairId' | 'secretaryId'>, u: Pick<User, 'id' | 'roles'>) {
    return [m.createdById, m.chairId, m.secretaryId].includes(u.id) || u.roles.includes('ADMIN');
  }

  /** The meeting for someone who may see it: its participants, and those who keep the registers or oversee. */
  private async load(id: string, u: User) {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: FULL });
    if (!m) throw new NotFoundException('MEETING_NOT_FOUND');
    const members = await this.memberIds(m.chatId);
    if (!members.includes(u.id) && !seesAllDocuments(u)) throw new NotFoundException('MEETING_NOT_FOUND');
    return { m, members };
  }

  private async loadEditable(id: string, u: User) {
    const loaded = await this.load(id, u);
    if (!this.canEdit(loaded.m, u)) throw new ForbiddenException('FORBIDDEN');
    // once the protocol is with the approvers or registered, the record behind it no longer changes
    if (loaded.m.protocol && !EDITABLE_DOCUMENT_STATUSES.includes(loaded.m.protocol.status)) throw new ConflictException('PROTOCOL_LOCKED');
    return loaded;
  }

  private async assertActive(ids: string[]) {
    const unique = [...new Set(ids)];
    if ((await this.prisma.user.count({ where: { id: { in: unique }, isActive: true, isExternal: false } })) !== unique.length) throw new BadRequestException('USER_NOT_FOUND');
  }

  // ---- mapping ----
  private async toDto(m: MeetingFull, members: string[], u: User): Promise<MeetingDto> {
    const decisions = await this.prisma.decision.findMany({ where: { sourceChatId: m.chatId }, include: { responses: true }, orderBy: { createdAt: 'asc' } });
    return {
      id: m.id,
      subject: m.subject,
      startsAt: m.startsAt.toISOString(),
      place: m.place,
      projectId: m.projectId,
      chatId: m.chatId,
      chairId: m.chairId,
      secretaryId: m.secretaryId,
      createdById: m.createdById,
      status: m.status,
      participantIds: members,
      items: m.items.map((i) => ({
        id: i.id,
        position: i.position,
        title: i.title,
        heard: i.heard,
        resolutions: i.resolutions.map((r): MeetingResolutionDto => ({ id: r.id, kind: r.kind, text: r.text, responsibleId: r.responsibleId, due: dateOnly(r.due), decisionId: r.decisionId })),
      })),
      chatDecisions: decisions.map((d) => ({ id: d.id, text: d.text, status: decisionStatus(d.addresseeIds, d.responses) })),
      protocolId: m.protocolId,
      protocolStatus: m.protocol?.status ?? null,
      canEdit: this.canEdit(m, u),
    };
  }

  private async view(id: string, u: User) {
    const { m, members } = await this.load(id, u);
    return this.toDto(m, members, u);
  }

  // ---- meetings ----
  async create(actor: User, dto: CreateMeetingDto, ip?: string) {
    const chairId = dto.chairId ?? actor.id;
    const secretaryId = dto.secretaryId ?? actor.id;
    const people = [...new Set([actor.id, chairId, secretaryId, ...dto.participantIds])];
    if (people.length > GROUP_MAX_MEMBERS) throw new BadRequestException('GROUP_TOO_LARGE');
    await this.assertActive(people);
    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('INVALID_DATE');
    if (dto.projectId) {
      const p = await this.prisma.project.findUnique({ where: { id: dto.projectId }, include: { members: { select: { userId: true } } } });
      if (!p || !(isOverseer(actor) || p.managerId === actor.id || p.members.some((x) => x.userId === actor.id))) throw new NotFoundException('PROJECT_NOT_FOUND');
    }
    const agenda = (dto.agenda ?? []).map((t) => t.trim()).filter(Boolean);

    const meeting = await this.prisma.$transaction(async (tx) => {
      const chat = await tx.chat.create({
        data: { type: 'GROUP', title: dto.subject, createdById: actor.id, members: { create: people.map((id) => ({ userId: id, role: id === actor.id ? ('OWNER' as const) : ('MEMBER' as const) })) } },
      });
      return tx.meeting.create({
        data: {
          subject: dto.subject,
          startsAt,
          place: dto.place?.trim() || null,
          projectId: dto.projectId ?? null,
          chatId: chat.id,
          chairId,
          secretaryId,
          createdById: actor.id,
          items: { create: agenda.map((title, k) => ({ title, position: k + 1 })) },
        },
      });
    });
    await this.audit.log({ actorId: actor.id, action: 'meeting.created', entityType: 'Meeting', entityId: meeting.id, data: { subject: meeting.subject, participants: people }, ip });
    this.realtime.emit(people, 'chat:updated', { chatId: meeting.chatId });
    return this.view(meeting.id, actor);
  }

  async list(actor: User) {
    const where: Prisma.MeetingWhereInput = seesAllDocuments(actor) ? {} : { chat: { members: { some: { userId: actor.id } } } };
    const rows = await this.prisma.meeting.findMany({ where, include: FULL, orderBy: { startsAt: 'desc' }, take: 200 });
    return Promise.all(rows.map(async (m) => this.toDto(m, await this.memberIds(m.chatId), actor)));
  }

  get(id: string, actor: User) {
    return this.view(id, actor);
  }

  async update(id: string, actor: User, dto: UpdateMeetingDto, ip?: string) {
    const { m } = await this.loadEditable(id, actor);
    const data: Prisma.MeetingUncheckedUpdateInput = {};
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.startsAt !== undefined) {
      const d = new Date(dto.startsAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('INVALID_DATE');
      data.startsAt = d;
    }
    if (dto.place !== undefined) data.place = dto.place.trim() || null;
    if (dto.status !== undefined) data.status = dto.status;
    const people = [dto.chairId, dto.secretaryId].filter((x): x is string => !!x);
    if (people.length) {
      await this.assertActive(people);
      if (dto.chairId) data.chairId = dto.chairId;
      if (dto.secretaryId) data.secretaryId = dto.secretaryId;
    }
    await this.prisma.$transaction(async (tx) => {
      // the chair and the secretary are always in the meeting chat
      for (const uid of people) await tx.chatMember.upsert({ where: { chatId_userId: { chatId: m.chatId, userId: uid } }, update: {}, create: { chatId: m.chatId, userId: uid } });
      if (dto.subject !== undefined) await tx.chat.update({ where: { id: m.chatId }, data: { title: dto.subject } });
      await tx.meeting.update({ where: { id }, data });
    });
    await this.audit.log({ actorId: actor.id, action: 'meeting.updated', entityType: 'Meeting', entityId: id, data: JSON.parse(JSON.stringify(dto)), ip });
    this.realtime.emit(await this.memberIds(m.chatId), 'chat:updated', { chatId: m.chatId });
    return this.view(id, actor);
  }

  async setParticipant(id: string, actor: User, userId: string, present: boolean, ip?: string) {
    const { m, members } = await this.loadEditable(id, actor);
    if (present) {
      if (members.length >= GROUP_MAX_MEMBERS && !members.includes(userId)) throw new BadRequestException('GROUP_TOO_LARGE');
      await this.assertActive([userId]);
      const chat = await this.prisma.chat.findUniqueOrThrow({ where: { id: m.chatId }, select: { lastSeq: true } });
      await this.prisma.chatMember.upsert({ where: { chatId_userId: { chatId: m.chatId, userId } }, update: {}, create: { chatId: m.chatId, userId, lastReadSeq: chat.lastSeq } });
    } else {
      if ([m.chairId, m.secretaryId, m.createdById].includes(userId)) throw new BadRequestException('CANNOT_REMOVE_ORGANIZER');
      // someone who is to carry out an instruction of this meeting is still a participant
      if (await this.prisma.meetingResolution.count({ where: { responsibleId: userId, item: { meetingId: id } } })) throw new BadRequestException('PARTICIPANT_HAS_INSTRUCTIONS');
      await this.prisma.chatMember.deleteMany({ where: { chatId: m.chatId, userId } });
      this.realtime.emit([userId], 'chat:updated', { chatId: m.chatId });
    }
    await this.audit.log({ actorId: actor.id, action: present ? 'meeting.participant_added' : 'meeting.participant_removed', entityType: 'Meeting', entityId: id, data: { userId }, ip });
    this.realtime.emit(await this.memberIds(m.chatId), 'chat:updated', { chatId: m.chatId });
    return this.view(id, actor);
  }

  // ---- agenda ----
  async addItem(id: string, actor: User, dto: ItemDto, ip?: string) {
    await this.loadEditable(id, actor);
    const last = await this.prisma.meetingItem.aggregate({ where: { meetingId: id }, _max: { position: true } });
    const item = await this.prisma.meetingItem.create({ data: { meetingId: id, title: dto.title, position: (last._max.position ?? 0) + 1 } });
    await this.audit.log({ actorId: actor.id, action: 'meeting.item_added', entityType: 'Meeting', entityId: id, data: { itemId: item.id, title: item.title }, ip });
    return this.view(id, actor);
  }

  private async item(meetingId: string, itemId: string) {
    const item = await this.prisma.meetingItem.findFirst({ where: { id: itemId, meetingId } });
    if (!item) throw new NotFoundException('ITEM_NOT_FOUND');
    return item;
  }

  async updateItem(id: string, itemId: string, actor: User, dto: UpdateItemDto, ip?: string) {
    await this.loadEditable(id, actor);
    await this.item(id, itemId);
    await this.prisma.meetingItem.update({ where: { id: itemId }, data: { title: dto.title, heard: dto.heard === undefined ? undefined : dto.heard.trim() || null } });
    await this.audit.log({ actorId: actor.id, action: 'meeting.item_updated', entityType: 'Meeting', entityId: id, data: { itemId, ...JSON.parse(JSON.stringify(dto)) }, ip });
    return this.view(id, actor);
  }

  async removeItem(id: string, itemId: string, actor: User, ip?: string) {
    await this.loadEditable(id, actor);
    await this.item(id, itemId);
    await this.prisma.$transaction(async (tx) => {
      await tx.meetingItem.delete({ where: { id: itemId } });
      const rest = await tx.meetingItem.findMany({ where: { meetingId: id }, orderBy: { position: 'asc' } });
      for (const [k, r] of rest.entries()) if (r.position !== k + 1) await tx.meetingItem.update({ where: { id: r.id }, data: { position: k + 1 } });
    });
    await this.audit.log({ actorId: actor.id, action: 'meeting.item_removed', entityType: 'Meeting', entityId: id, data: { itemId }, ip });
    return this.view(id, actor);
  }

  // ---- decisions and instructions ----
  async addResolution(id: string, itemId: string, actor: User, dto: ResolutionDto, ip?: string) {
    const { m, members } = await this.loadEditable(id, actor);
    await this.item(id, itemId);
    let text = dto.text;
    let decisionId: string | null = null;
    if (dto.decisionId) {
      if (dto.kind !== 'DECISION') throw new BadRequestException('DECISION_LINK_ONLY_FOR_DECISIONS');
      const d = await this.prisma.decision.findFirst({ where: { id: dto.decisionId, sourceChatId: m.chatId } });
      if (!d) throw new BadRequestException('DECISION_NOT_IN_MEETING');
      decisionId = d.id;
      text = text || d.text;
    }
    if (!text) throw new BadRequestException('TEXT_REQUIRED');
    let due: Date | null = null;
    if (dto.kind === 'INSTRUCTION') {
      // an instruction without a person and a date cannot be tracked
      if (!dto.responsibleId) throw new BadRequestException('RESPONSIBLE_REQUIRED');
      if (!dto.due) throw new BadRequestException('DUE_REQUIRED');
      if (!members.includes(dto.responsibleId)) throw new BadRequestException('RESPONSIBLE_NOT_IN_MEETING');
      due = parseDate(dto.due);
      if (!due) throw new BadRequestException('INVALID_DATE');
    } else if (dto.responsibleId || dto.due) {
      throw new BadRequestException('DECISION_HAS_NO_RESPONSIBLE');
    }
    const last = await this.prisma.meetingResolution.aggregate({ where: { itemId }, _max: { position: true } });
    const r = await this.prisma.meetingResolution.create({
      data: { itemId, position: (last._max.position ?? 0) + 1, kind: dto.kind, text, responsibleId: dto.kind === 'INSTRUCTION' ? dto.responsibleId : null, due, decisionId },
    });
    await this.audit.log({ actorId: actor.id, action: 'meeting.resolution_added', entityType: 'Meeting', entityId: id, data: { itemId, resolutionId: r.id, kind: r.kind, responsibleId: r.responsibleId }, ip });
    return this.view(id, actor);
  }

  async updateResolution(id: string, resolutionId: string, actor: User, dto: UpdateResolutionDto, ip?: string) {
    const { members } = await this.loadEditable(id, actor);
    const r = await this.prisma.meetingResolution.findFirst({ where: { id: resolutionId, item: { meetingId: id } } });
    if (!r) throw new NotFoundException('RESOLUTION_NOT_FOUND');
    const data: Prisma.MeetingResolutionUncheckedUpdateInput = {};
    if (dto.text !== undefined) data.text = dto.text;
    if (r.kind === 'INSTRUCTION') {
      if (dto.responsibleId !== undefined) {
        if (!members.includes(dto.responsibleId)) throw new BadRequestException('RESPONSIBLE_NOT_IN_MEETING');
        data.responsibleId = dto.responsibleId;
      }
      if (dto.due !== undefined) {
        const due = parseDate(dto.due);
        if (!due) throw new BadRequestException('INVALID_DATE');
        data.due = due;
      }
    } else if (dto.responsibleId !== undefined || dto.due !== undefined) {
      throw new BadRequestException('DECISION_HAS_NO_RESPONSIBLE');
    }
    await this.prisma.meetingResolution.update({ where: { id: resolutionId }, data });
    await this.audit.log({ actorId: actor.id, action: 'meeting.resolution_updated', entityType: 'Meeting', entityId: id, data: { resolutionId, previousText: r.text }, ip });
    return this.view(id, actor);
  }

  async removeResolution(id: string, resolutionId: string, actor: User, ip?: string) {
    await this.loadEditable(id, actor);
    const done = await this.prisma.meetingResolution.deleteMany({ where: { id: resolutionId, item: { meetingId: id } } });
    if (done.count === 0) throw new NotFoundException('RESOLUTION_NOT_FOUND');
    await this.audit.log({ actorId: actor.id, action: 'meeting.resolution_removed', entityType: 'Meeting', entityId: id, data: { resolutionId }, ip });
    return this.view(id, actor);
  }

  // ---- protocol ----
  /** Makes (or refreshes) the protocol document from the record of the meeting. It then goes through approval like any document. */
  async makeProtocol(id: string, actor: User, dto: ProtocolDto, ip?: string) {
    const { m, members } = await this.loadEditable(id, actor);
    const kind = await this.prisma.documentKind.findUnique({ where: { code: 'PROTOCOL' } });
    if (!kind || !kind.isActive) throw new NotFoundException('KIND_NOT_FOUND');
    const template = await this.kinds.activeTemplate(kind.id, dto.lang);
    if (!template) throw new BadRequestException('NO_TEMPLATE');

    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: [...members, m.chairId, m.secretaryId, ...m.items.flatMap((i) => i.resolutions.map((r) => r.responsibleId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const day = dateOnly(m.startsAt)!;
    const data = protocolData(
      {
        chair: names.get(m.chairId) ?? '',
        secretary: names.get(m.secretaryId) ?? '',
        participants: members.map((x) => names.get(x) ?? '').filter(Boolean).sort((a, b) => a.localeCompare(b)),
        items: m.items.map((i) => ({
          title: i.title,
          heard: i.heard,
          resolutions: i.resolutions.map((r) => ({ kind: r.kind, text: r.text, responsible: r.responsibleId ? names.get(r.responsibleId) ?? null : null, due: dateOnly(r.due) })),
        })),
      },
      dto.lang,
    );
    const title = protocolTitle(m.subject, day, dto.lang);
    // the date of the document is the date of the meeting, in the centre's time zone
    const docDate = parseDate(new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(m.startsAt))!;

    let docId = m.protocolId;
    if (docId) {
      const old = await this.prisma.$transaction(async (tx) => {
        const cur = await tx.document.findUniqueOrThrow({ where: { id: docId! } });
        if (!EDITABLE_DOCUMENT_STATUSES.includes(cur.status)) throw new ConflictException('PROTOCOL_LOCKED');
        await tx.document.update({ where: { id: docId! }, data: { title, lang: dto.lang, docDate, data: JSON.parse(JSON.stringify(data)), templateId: template.id } });
        return this.documents.invalidateFiles(tx, cur);
      });
      await this.documents.dropFiles(old);
    } else {
      const created = await this.prisma.document.create({
        data: { kindId: kind.id, templateId: template.id, title, lang: dto.lang, data: JSON.parse(JSON.stringify(data)), docDate, authorId: actor.id },
      });
      docId = created.id;
      await this.prisma.meeting.update({ where: { id }, data: { protocolId: docId } });
    }
    await this.audit.log({ actorId: actor.id, action: 'meeting.protocol_made', entityType: 'Meeting', entityId: id, data: { documentId: docId, lang: dto.lang }, ip });
    return { documentId: docId, meeting: await this.view(id, actor) };
  }
}
