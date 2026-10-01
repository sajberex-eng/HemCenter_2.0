/**
 * Creates an administrator.
 *   Without ADMIN_LOGIN: creates "admin" only when no administrator exists yet (first install).
 *   With ADMIN_LOGIN:    creates that account if it does not exist (used by e2e tests).
 *   ADMIN_PASSWORD       default: random, printed once.
 *   ADMIN_MUST_CHANGE    "false" lets the account skip the forced password change.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, randomToken } from '../common/password';

async function main() {
  const prisma = new PrismaClient();
  try {
    const explicit = process.env.ADMIN_LOGIN?.toLowerCase();
    const login = explicit ?? 'admin';
    if (explicit) {
      if (await prisma.user.findUnique({ where: { login } })) {
        console.log(`Account already exists: ${login}`);
        return;
      }
    } else {
      const existing = await prisma.user.findFirst({ where: { roles: { has: 'ADMIN' } } });
      if (existing) {
        console.log(`Administrator already exists: ${existing.login}`);
        return;
      }
    }
    const password = process.env.ADMIN_PASSWORD ?? randomToken(12);
    await prisma.user.create({
      data: {
        login,
        passwordHash: await hashPassword(password),
        fullName: 'Администратор',
        roles: ['ADMIN'],
        mustChangePassword: process.env.ADMIN_MUST_CHANGE !== 'false',
        consentAt: new Date(),
      },
    });
    console.log(`Administrator created. Login: ${login}`);
    if (!process.env.ADMIN_PASSWORD) console.log(`One-time password: ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}
main();
