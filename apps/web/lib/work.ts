import type { Role, UserDto } from '@hemcenter/shared';

/** Who may create projects and see the workload matrix (the server enforces it too). */
export const PROJECT_ROLES: Role[] = ['ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER'];
export const canCreateProjects = (u: Pick<UserDto, 'roles'> | null | undefined) => !!u?.roles.some((r) => PROJECT_ROLES.includes(r));
