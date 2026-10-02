import { Injectable } from '@nestjs/common';
import { PROJECT_STATUSES, type DashboardDto, type ProjectStatus } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { WorkloadService } from '../projects/workload.service';
import { ACTIONABLE } from '../assignments/assignment-rules';
import { decisionStatus, parseDate, todayIn } from '../projects/project-rules';

const DAY = 86_400_000;

/** One screen for the head of the centre: what is late, who is overloaded, what waits for an answer. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workload: WorkloadService,
  ) {}

  async build(now = new Date()): Promise<DashboardDto> {
    const today = parseDate(todayIn(undefined, now))!;
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const [statusRows, lateMilestones, lateTasks, lateAssignments, openAssignments, reviewAssignments, done30, decisions, matrix, inReview, registered] = await Promise.all([
      this.prisma.project.groupBy({ by: ['status'], _count: true }),
      this.prisma.milestone.findMany({ where: { doneAt: null, dueDate: { lt: today }, project: { status: { in: ['PLANNED', 'ACTIVE'] } } }, select: { project: { select: { id: true, name: true } } } }),
      this.prisma.task.count({ where: { status: { not: 'DONE' }, dueDate: { lt: today } } }),
      this.prisma.assignment.findMany({ where: { status: { in: [...ACTIONABLE] }, dueDate: { lt: today } }, select: { responsibleId: true, responsible: { select: { fullName: true } } } }),
      this.prisma.assignment.count({ where: { status: { notIn: ['DONE', 'REMOVED'] } } }),
      this.prisma.assignment.count({ where: { status: 'REVIEW' } }),
      this.prisma.assignment.count({ where: { status: 'DONE', doneAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
      this.prisma.decision.findMany({ where: { sourceMessage: { deletedAt: null } }, include: { responses: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
      this.workload.matrix(),
      this.prisma.document.count({ where: { status: 'IN_REVIEW' } }),
      this.prisma.document.count({ where: { status: 'REGISTERED', registeredAt: { gte: monthStart } } }),
    ]);

    const byStatus = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<ProjectStatus, number>;
    statusRows.forEach((r) => (byStatus[r.status] = r._count));

    const perProject = new Map<string, { id: string; name: string; overdue: number }>();
    for (const m of lateMilestones) {
      const e = perProject.get(m.project.id) ?? { id: m.project.id, name: m.project.name, overdue: 0 };
      e.overdue += 1;
      perProject.set(m.project.id, e);
    }

    const perPerson = new Map<string, { userId: string; fullName: string; count: number }>();
    for (const a of lateAssignments) {
      const e = perPerson.get(a.responsibleId) ?? { userId: a.responsibleId, fullName: a.responsible.fullName, count: 0 };
      e.count += 1;
      perPerson.set(a.responsibleId, e);
    }

    const waiting = decisions
      .filter((d) => decisionStatus(d.addresseeIds, d.responses) === 'PENDING')
      .map((d) => ({
        id: d.id,
        text: d.text.slice(0, 200),
        chatId: d.sourceChatId,
        waitingFor: d.addresseeIds.filter((id) => !d.responses.some((r) => r.userId === id)).length,
        ageDays: Math.floor((now.getTime() - d.createdAt.getTime()) / DAY),
      }))
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 10);

    return {
      generatedAt: now.toISOString(),
      projects: { byStatus, withOverdueMilestones: [...perProject.values()].sort((a, b) => b.overdue - a.overdue) },
      assignments: { open: openAssignments, overdue: lateAssignments.length, inReview: reviewAssignments, doneLast30Days: done30, overdueByPerson: [...perPerson.values()].sort((a, b) => b.count - a.count) },
      tasks: { overdue: lateTasks },
      decisionsWaiting: waiting,
      overloaded: matrix.people.filter((p) => p.overloaded).map((p) => ({ userId: p.userId, fullName: p.fullName, total: p.total })).sort((a, b) => b.total - a.total),
      documents: { inReview, registeredThisMonth: registered },
    };
  }
}
