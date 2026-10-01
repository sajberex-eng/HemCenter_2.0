import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { hashPassword } from '../src/common/password';

export const prisma = new PrismaClient();
export const PASSWORD = 'Str0ng-password-1';

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDb() {
  // AuditLog is append-only by trigger, so it is cleared with TRUNCATE (not covered by the row trigger).
  await prisma.$executeRawUnsafe('TRUNCATE "AuditLog", "Invitation", "Session", "User", "Department", "Position" RESTART IDENTITY CASCADE');
}

export async function makeUser(login: string, roles: ('ADMIN' | 'EMPLOYEE' | 'MANAGEMENT' | 'SECRETARY' | 'PROJECT_MANAGER')[] = ['EMPLOYEE']) {
  return prisma.user.create({
    data: { login, passwordHash: await hashPassword(PASSWORD), fullName: `User ${login}`, roles, mustChangePassword: false },
  });
}

export async function loginAs(app: INestApplication, login: string, password = PASSWORD) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ login, password });
  return res;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
