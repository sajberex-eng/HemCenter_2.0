import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { LOADED_PROJECT_STATUSES, WORKLOAD_LIMIT } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { isOverloaded, totalLoad } from './project-rules';

@Injectable()
export class WorkloadService {
  constructor(private readonly prisma: PrismaService) {}

  private async rows(userIds?: string[]) {
    return this.prisma.projectMember.findMany({
      where: userIds ? { userId: { in: userIds } } : { project: { status: { in: [...LOADED_PROJECT_STATUSES] } } },
      select: { userId: true, allocation: true, roleTitle: true, project: { select: { id: true, name: true, status: true } } },
      orderBy: { project: { name: 'asc' } },
    });
  }

  /** One person's shares per project and their total (TZ 3.4). */
  async forUser(userId: string) {
    const rows = await this.rows([userId]);
    const total = totalLoad(rows.map((r) => ({ allocation: r.allocation, projectStatus: r.project.status })));
    return {
      total,
      limit: WORKLOAD_LIMIT,
      overloaded: isOverloaded(total),
      projects: rows.map((r) => ({ projectId: r.project.id, name: r.project.name, status: r.project.status, allocation: r.allocation, roleTitle: r.roleTitle })),
    };
  }

  /** Everyone who sits in at least one planned or running project: rows are people, columns are projects. */
  async matrix(_actor?: User) {
    const rows = await this.rows();
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] }, isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    const projects = new Map<string, { id: string; name: string; status: string }>();
    rows.forEach((r) => projects.set(r.project.id, r.project));
    return {
      limit: WORKLOAD_LIMIT,
      projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
      people: people.map((p) => {
        const mine = rows.filter((r) => r.userId === p.id);
        const total = mine.reduce((s, r) => s + r.allocation, 0);
        return {
          userId: p.id,
          fullName: p.fullName,
          total,
          overloaded: isOverloaded(total),
          cells: mine.map((r) => ({ projectId: r.project.id, allocation: r.allocation })),
        };
      }),
    };
  }
}
