export const ROLES = ['ADMIN', 'MANAGEMENT', 'SECRETARY', 'PROJECT_MANAGER', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const LOCALES = ['ru', 'kk'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

export const PASSWORD_MIN_LENGTH = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface UserDto {
  id: string;
  login: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  roles: Role[];
  locale: Locale;
  isActive: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  /** True for an administrator who must enable two-factor authentication before using admin features. */
  mfaSetupRequired: boolean;
  departmentId: string | null;
  positionId: string | null;
}

export const TOTP_RECOVERY_CODES = 10;

// ---- Messenger -------------------------------------------------------------

export const CHAT_TYPES = ['DIRECT', 'GROUP', 'ARCHIVE'] as const;
export type ChatType = (typeof CHAT_TYPES)[number];
export const NOTIFY_MODES = ['ALL', 'MENTIONS', 'NONE'] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];
export type ChatRole = 'OWNER' | 'MEMBER';

export const MESSAGE_MAX_LENGTH = 4000;
export const GROUP_TITLE_MAX_LENGTH = 100;
export const GROUP_MAX_MEMBERS = 100;
export const MESSAGES_PAGE_SIZE = 50;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_PAGE_SIZE = 30;
export const MAX_PINS_PER_CHAT = 5;
/** How many messages are loaded on each side of a search hit. */
export const AROUND_WINDOW = 25;

// ---- Project office --------------------------------------------------------

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const DECISION_ANSWERS = ['AGREE', 'OBJECT', 'ACKNOWLEDGED'] as const;
export type DecisionAnswer = (typeof DECISION_ANSWERS)[number];
/** Projects counted towards a person's workload. */
export const LOADED_PROJECT_STATUSES: readonly ProjectStatus[] = ['PLANNED', 'ACTIVE'];
export const WORKLOAD_LIMIT = 100;
export const TITLE_MAX_LENGTH = 200;
export const TEXT_MAX_LENGTH = 4000;

/** A task shown under the message it was created from. */
export interface TaskCardDto {
  id: string;
  title: string;
  assigneeId: string;
  dueDate: string | null;
  status: TaskStatus;
  overdue: boolean;
}

export interface TaskDto extends TaskCardDto {
  description: string | null;
  coAssigneeIds: string[];
  projectId: string | null;
  createdById: string;
  sourceChatId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
}

export interface MilestoneDto {
  id: string;
  title: string;
  dueDate: string;
  doneAt: string | null;
  overdue: boolean;
}

export interface ProjectMemberDto {
  userId: string;
  fullName: string;
  allocation: number;
  roleTitle: string | null;
  /** The person's total over all planned and running projects. */
  totalLoad: number;
  overloaded: boolean;
}

export interface ProjectDto {
  id: string;
  name: string;
  goal: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  managerId: string;
  curatorId: string | null;
  chatId: string;
  members: ProjectMemberDto[];
  milestones: MilestoneDto[];
  createdAt: string;
}

export interface WorkloadDto {
  total: number;
  limit: number;
  overloaded: boolean;
  projects: { projectId: string; name: string; status: ProjectStatus; allocation: number; roleTitle: string | null }[];
}

export interface WorkloadMatrixDto {
  limit: number;
  projects: { id: string; name: string; status: ProjectStatus }[];
  people: { userId: string; fullName: string; total: number; overloaded: boolean; cells: { projectId: string; allocation: number }[] }[];
}

/** pending: someone has not answered yet; objections: at least one objection; confirmed: everyone answered, none objected. */
export type DecisionStatus = 'PENDING' | 'OBJECTIONS' | 'CONFIRMED';

export interface DecisionDto {
  id: string;
  text: string;
  createdById: string;
  addresseeIds: string[];
  responses: { userId: string; answer: DecisionAnswer; comment: string | null; at: string }[];
  status: DecisionStatus;
  projectId: string | null;
  sourceChatId: string;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  chatId: string;
  seq: number;
  authorId: string;
  /** null when the message was deleted */
  body: string | null;
  replyTo: { id: string; authorId: string; body: string | null } | null;
  mentionIds: string[];
  attachments: AttachmentDto[];
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  tasks: TaskCardDto[];
  decision: DecisionDto | null;
}

export interface ChatMemberDto {
  userId: string;
  role: ChatRole;
  /** Everything up to this message number has been read by this member. */
  lastReadSeq: number;
}

export interface ChatDto {
  id: string;
  type: ChatType;
  title: string | null;
  members: ChatMemberDto[];
  lastMessage: MessageDto | null;
  lastMessageAt: string | null;
  unreadCount: number;
  /** The caller's own notification setting for this chat. */
  notifyMode: NotifyMode;
}

/** Events the server pushes over the socket. */
export interface ServerEvents {
  'message:new': MessageDto;
  'message:updated': MessageDto;
  'message:deleted': MessageDto;
  'chat:read': { chatId: string; userId: string; lastReadSeq: number };
  /** Chat created, renamed, or its membership changed: clients reload the chat. */
  'chat:updated': { chatId: string };
  /** Pinned messages of a chat changed: clients reload the pins. */
  'chat:pins': { chatId: string };
  /** A document changed state (sent for approval, approved, returned, registered): clients refresh lists and counters. */
  'document:updated': { documentId: string };
}

export interface AttachmentDto {
  id: string;
  name: string;
  /** image/png|jpeg|gif|webp for real raster images, otherwise application/octet-stream */
  mime: string;
  size: number;
  isImage: boolean;
}

// ---- Documents -------------------------------------------------------------

export const DOCUMENT_STATUSES = ['DRAFT', 'IN_REVIEW', 'RETURNED', 'APPROVED', 'SIGNED', 'REGISTERED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
/** The statuses in which the author may still edit the text. */
export const EDITABLE_DOCUMENT_STATUSES: readonly DocumentStatus[] = ['DRAFT', 'RETURNED'];

/** What goes into the template fields of a document. Every part is optional; a template uses what it needs. */
export interface DocData {
  preamble?: string;
  body?: string;
  recipient?: string;
  signer?: string;
  chair?: string;
  secretary?: string;
  participants?: string[];
  agenda?: string[];
  decisions?: string[];
  items?: { text: string; responsible?: string; due?: string }[];
}

export interface DocumentKindDto {
  id: string;
  code: string | null;
  nameRu: string;
  nameKk: string;
  prefix: string;
  isActive: boolean;
}

export interface DocumentTemplateDto {
  id: string;
  kindId: string;
  lang: Locale;
  version: number;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export const STEP_STATUSES = ['PENDING', 'APPROVED', 'RETURNED'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const APPROVAL_ACTION_KINDS = ['SUBMIT', 'APPROVE', 'RETURN', 'SCAN', 'REGISTER'] as const;
export type ApprovalActionKind = (typeof APPROVAL_ACTION_KINDS)[number];
export const MAX_APPROVERS = 20;

export interface ApprovalStepDto {
  id: string;
  approverId: string;
  /** Steps with the same stage are approved in parallel; stages follow one another. */
  stage: number;
  status: StepStatus;
  decidedAt: string | null;
  comment: string | null;
}

export interface ApprovalActionDto {
  id: string;
  round: number;
  actorId: string;
  kind: ApprovalActionKind;
  comment: string | null;
  at: string;
}

export interface DocumentScanDto {
  name: string;
  size: number;
  sha256: string;
  uploadedAt: string;
}

export interface DocumentDto {
  id: string;
  kindId: string;
  title: string;
  lang: Locale;
  data: DocData;
  status: DocumentStatus;
  docDate: string;
  authorId: string;
  registrationNumber: string | null;
  registeredAt: string | null;
  pdfSha256: string | null;
  round: number;
  steps: ApprovalStepDto[];
  /** The approval sheet; filled when a single document is opened, empty in lists. */
  actions: ApprovalActionDto[];
  scan: DocumentScanDto | null;
  /** It is this person's turn to approve or return the document. */
  awaitingMe: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Meetings --------------------------------------------------------------

export const MEETING_STATUSES = ['PLANNED', 'HELD', 'CANCELED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const RESOLUTION_KINDS = ['DECISION', 'INSTRUCTION'] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

export interface MeetingResolutionDto {
  id: string;
  kind: ResolutionKind;
  text: string;
  responsibleId: string | null;
  due: string | null;
  decisionId: string | null;
}

export interface MeetingItemDto {
  id: string;
  position: number;
  title: string;
  heard: string | null;
  resolutions: MeetingResolutionDto[];
}

export interface MeetingDto {
  id: string;
  subject: string;
  startsAt: string;
  place: string | null;
  projectId: string | null;
  chatId: string;
  chairId: string;
  secretaryId: string;
  createdById: string;
  status: MeetingStatus;
  participantIds: string[];
  items: MeetingItemDto[];
  /** Decisions made from messages of the meeting chat, which can be taken into the protocol. */
  chatDecisions: { id: string; text: string; status: DecisionStatus }[];
  protocolId: string | null;
  protocolStatus: DocumentStatus | null;
  /** The viewer may change the agenda and the record. */
  canEdit: boolean;
}
