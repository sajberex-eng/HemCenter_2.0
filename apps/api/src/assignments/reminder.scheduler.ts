import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';

const EVERY_MS = 60 * 60 * 1000;

/** Runs the reminders once an hour (and shortly after start-up). The job itself is idempotent per day. */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(private readonly assignments: AssignmentsService) {}

  private async run() {
    try {
      const n = await this.assignments.remind();
      if (n > 0) this.log.log(`sent ${n} reminder(s)`);
    } catch (e) {
      this.log.warn(`reminders failed: ${(e as Error).message}`);
    }
  }

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === 'true') return;
    this.first = setTimeout(() => void this.run(), 30_000);
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
