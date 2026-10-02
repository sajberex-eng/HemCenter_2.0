/**
 * Load test for the messenger: N people online at once in one group chat, each writing every few seconds.
 * Measures how long a message takes from "send" to "appears on every other screen" and how long the REST call takes,
 * and checks that nothing is lost. Acceptance (TZ 4): 50 online, delivery under 1 second.
 *
 *   BASE=http://localhost:4000 USERS=50 DURATION_S=60 RATE_MS=2000 npx tsx scripts/loadtest.ts
 *
 * Needs a running API with throttling off (DISABLE_THROTTLE=true) and an administrator login (ADMIN_LOGIN / ADMIN_PASSWORD).
 * It creates throw-away users named loadtest.<run>.<n>: use a test database, not the real one.
 */
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:4000';
const USERS = Number(process.env.USERS ?? 50);
const DURATION_S = Number(process.env.DURATION_S ?? 60);
const RATE_MS = Number(process.env.RATE_MS ?? 2000);
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'e2e-admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'E2e-admin-pass-1';
const PASSWORD = 'Load-test-pass-12345';
const run = Date.now().toString(36);

async function call<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; body: T; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const ms = performance.now() - t0;
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, ms };
}

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : NaN);
const max = (xs: number[]) => xs.reduce((m, x) => (x > m ? x : m), -Infinity); // not Math.max(...xs): that overflows the stack on big arrays
const fmt = (n: number) => (Number.isNaN(n) ? '-' : `${n.toFixed(0)} ms`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  idx: number;
  id: string;
  token: string;
  socket: Socket;
}

async function main() {
  console.log(`load test: ${USERS} people, ${DURATION_S}s, one message per person every ~${RATE_MS} ms, ${BASE}`);
  const admin = await call<{ accessToken: string }>('/auth/login', { method: 'POST', body: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } });
  if (admin.status !== 200) throw new Error(`administrator login failed (${admin.status})`);

  // people
  const clients: Client[] = [];
  for (let i = 0; i < USERS; i++) {
    const login = `loadtest.${run}.${i}`;
    const created = await call<{ inviteToken: string; user: { id: string } }>('/users', { method: 'POST', token: admin.body.accessToken, body: { login, fullName: `Нагрузка ${i}`, roles: ['EMPLOYEE'] } });
    if (created.status !== 201) throw new Error(`could not create ${login}: ${created.status}`);
    const accepted = await call<{ accessToken: string }>('/auth/accept-invite', { method: 'POST', body: { token: created.body.inviteToken, password: PASSWORD, consent: true } });
    if (accepted.status !== 200) throw new Error(`could not activate ${login}: ${accepted.status}`);
    clients.push({ idx: i, id: created.body.user.id, token: accepted.body.accessToken, socket: undefined as unknown as Socket });
  }
  const group = await call<{ id: string }>('/chats/groups', { method: 'POST', token: clients[0].token, body: { title: `Нагрузка ${run}`, memberIds: clients.slice(1).map((c) => c.id) } });
  if (group.status !== 201) throw new Error(`could not create the group: ${group.status} ${JSON.stringify(group.body)}`);
  const chatId = group.body.id;

  // everybody online
  const latencies: number[] = [];
  const seen = new Map<string, number>(); // message key -> how many screens got it
  let duplicates = 0;
  const gotBy = new Set<string>();
  await Promise.all(
    clients.map(
      (c) =>
        new Promise<void>((resolve, reject) => {
          const s = io(BASE, { path: '/api/socket.io', addTrailingSlash: false, auth: { token: c.token }, transports: ['websocket'], reconnection: false });
          c.socket = s;
          s.on('message:new', (m: { chatId: string; body: string }) => {
            if (m.chatId !== chatId || !m.body.startsWith('L|')) return;
            const [, , , ts] = m.body.split('|');
            latencies.push(Date.now() - Number(ts));
            const key = `${m.body}@${c.idx}`;
            if (gotBy.has(key)) duplicates++;
            gotBy.add(key);
            const base = m.body.split('@')[0];
            seen.set(base, (seen.get(base) ?? 0) + 1);
          });
          s.on('connect', () => resolve());
          s.on('connect_error', (e) => reject(e));
          setTimeout(() => reject(new Error('socket did not connect in 15 s')), 15_000);
        }),
    ),
  );
  console.log(`${USERS} sockets connected`);

  // talking
  const restMs: number[] = [];
  let sent = 0;
  let failed = 0;
  const end = Date.now() + DURATION_S * 1000;
  await Promise.all(
    clients.map(async (c) => {
      await sleep(Math.random() * RATE_MS);
      for (let n = 0; Date.now() < end; n++) {
        const body = `L|${c.idx}|${n}|${Date.now()}`;
        const r = await call('/chats/' + chatId + '/messages', { method: 'POST', token: c.token, body: { body } });
        restMs.push(r.ms);
        if (r.status === 201) sent++;
        else failed++;
        await sleep(RATE_MS * (0.5 + Math.random()));
      }
    }),
  );
  await sleep(3000); // stragglers

  // reading the history, as a person opening the chat would
  const opens: number[] = [];
  for (const c of clients.slice(0, 10)) opens.push((await call(`/chats/${chatId}/messages`, { token: c.token })).ms);

  const expected = sent * USERS; // the message reaches every member, the sender included
  const delivered = latencies.length;
  const p95 = pct(latencies, 95);
  console.log('');
  console.log(`messages sent:        ${sent} (failed: ${failed})`);
  console.log(`deliveries:           ${delivered} of ${expected} expected (${((delivered / expected) * 100).toFixed(2)} %), duplicates: ${duplicates}`);
  console.log(`delivery latency:     p50 ${fmt(pct(latencies, 50))}  p95 ${fmt(p95)}  p99 ${fmt(pct(latencies, 99))}  max ${fmt(max(latencies))}`);
  console.log(`send (REST) latency:  p50 ${fmt(pct(restMs, 50))}  p95 ${fmt(pct(restMs, 95))}  max ${fmt(max(restMs))}`);
  console.log(`open chat (REST):     p50 ${fmt(pct(opens, 50))}  max ${fmt(max(opens))}`);
  if (process.env.API_PID) {
    try {
      const status = (await import('node:fs')).readFileSync(`/proc/${process.env.API_PID}/status`, 'utf8');
      console.log(`API memory (RSS):     ${status.match(/VmRSS:\s+(\d+) kB/)?.[1] ?? '?'} kB`);
    } catch {
      /* not on this machine */
    }
  }
  clients.forEach((c) => c.socket.close());

  const ok = failed === 0 && delivered === expected && duplicates === 0 && p95 < 1000;
  console.log(ok ? '\nPASSED: nothing lost, p95 delivery under 1 second' : '\nFAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
