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
  departmentId: string | null;
  positionId: string | null;
}
