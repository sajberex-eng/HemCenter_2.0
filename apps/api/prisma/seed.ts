/**
 * Creates the first administrator if no admin exists.
 *   ADMIN_LOGIN (default "admin"), ADMIN_PASSWORD (default: random, printed once).
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, randomToken } from '../src/common/password';

async function main() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findFirst({ where: { roles: { has: 'ADMIN' } } });
    if (existing) {
      console.log(`Administrator already exists: ${existing.login}`);
      return;
    }
    const login = (process.env.ADMIN_LOGIN ?? 'admin').toLowerCase();
    const password = process.env.ADMIN_PASSWORD ?? randomToken(12);
    await prisma.user.create({
      data: {
        login,
        passwordHash: await hashPassword(password),
        fullName: 'Администратор',
        roles: ['ADMIN'],
        mustChangePassword: true,
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
