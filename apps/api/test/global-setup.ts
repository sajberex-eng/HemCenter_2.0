import { execSync } from 'child_process';

// Applies migrations to a dedicated test database before the suite runs.
export default function setup() {
  const url = 'postgresql://hemcenter:hemcenter@localhost:5432/hemcenter_test';
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
}
