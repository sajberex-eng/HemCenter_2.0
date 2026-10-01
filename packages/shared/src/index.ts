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

export const CHAT_TYPES = ['DIRECT', 'GROUP'] as const;
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
}

export interface AttachmentDto {
  id: string;
  name: string;
  /** image/png|jpeg|gif|webp for real raster images, otherwise application/octet-stream */
  mime: string;
  size: number;
  isImage: boolean;
}
