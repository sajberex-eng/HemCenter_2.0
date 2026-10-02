/**
 * Fills a running API with demo data (test data only!): people, a project with a team, a chat with a
 * decision and a task, a memo in review. Goes through the public API, so every business rule applies.
 *   API_URL (default http://localhost:4000)  ADMIN_LOGIN/ADMIN_PASSWORD (default demo-admin / Demo-pass-123)
 * Safe to run twice: it stops when the demo people already exist.
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN = { login: process.env.ADMIN_LOGIN ?? 'demo-admin', password: process.env.ADMIN_PASSWORD ?? 'Demo-pass-123' };
const PASSWORD = 'Demo-pass-123';

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
const login = async (l: string, p = PASSWORD) => (await call('POST', '/auth/login', undefined, { login: l, password: p })).accessToken as string;
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

const PEOPLE = [
  { login: 'director', fullName: 'Серикова Айгуль Маратовна', roles: ['MANAGEMENT'] },
  { login: 'manager', fullName: 'Ахметов Данияр Нурланович', roles: ['PROJECT_MANAGER'] },
  { login: 'secretary', fullName: 'Ким Елена Викторовна', roles: ['SECRETARY'] },
  { login: 'anna', fullName: 'Иванова Анна Сергеевна', roles: ['EMPLOYEE'] },
  { login: 'boris', fullName: 'Сапаров Борис Ержанович', roles: ['EMPLOYEE'] },
] as const;

async function main() {
  const admin = await login(ADMIN.login, ADMIN.password);
  const existing = (await call('GET', '/users?includeInactive=true', admin)) as { login: string }[] | { items: { login: string }[] };
  const list = Array.isArray(existing) ? existing : existing.items;
  if (list.some((u) => u.login === 'director')) {
    console.log('Demo data already present, nothing to do.');
    return;
  }

  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const { inviteToken, user } = await call('POST', '/users', admin, { login: p.login, fullName: p.fullName, roles: p.roles });
    await call('POST', '/auth/accept-invite', undefined, { token: inviteToken, password: PASSWORD, consent: true });
    ids[p.login] = user.id;
  }
  const [pm, anna, boris, secretary] = await Promise.all(['manager', 'anna', 'boris', 'secretary'].map((l) => login(l)));

  // project with a team; its chat is created with it
  const project = await call('POST', '/projects', pm, {
    name: 'Реестр поставщиков',
    goal: 'Единый реестр поставщиков и порядок их согласования',
    startDate: inDays(-14),
    endDate: inDays(60),
    members: [
      { userId: ids.anna, allocation: 50, roleTitle: 'Аналитик' },
      { userId: ids.boris, allocation: 30, roleTitle: 'Закупки' },
    ],
  });
  await call('POST', `/projects/${project.id}/milestones`, pm, { title: 'Черновик реестра', dueDate: inDays(-2) });
  await call('POST', `/projects/${project.id}/milestones`, pm, { title: 'Согласование с юристами', dueDate: inDays(21) });

  const say = async (token: string, body: string) => (await call('POST', `/chats/${project.chatId}/messages`, token, { body })) as { id: string };
  await say(pm, 'Коллеги, добрый день! Начинаем работу над реестром поставщиков.');
  const proposal = await say(pm, 'Предлагаю хранить реестр в единой таблице и обновлять раз в месяц');
  await say(anna, 'Согласна, подготовлю структуру до пятницы.');
  const ask = await say(pm, 'Борис, нужен список текущих поставщиков с контактами');
  await call('POST', `/chats/${project.chatId}/messages/${proposal.id}/decision`, pm, { text: 'Реестр поставщиков ведём в единой таблице, обновляем раз в месяц', addresseeIds: [ids.anna, ids.boris] });
  await call('POST', `/chats/${project.chatId}/messages/${ask.id}/task`, pm, { title: 'Список поставщиков с контактами', assigneeId: ids.boris, dueDate: inDays(5) });
  const decision = (await call('GET', '/decisions/pending', anna)) as { id: string }[];
  if (decision[0]) await call('POST', `/decisions/${decision[0].id}/answer`, anna, { answer: 'AGREE' });

  // a direct chat
  const direct = await call('POST', '/chats/direct', anna, { userId: ids.boris });
  await call('POST', `/chats/${direct.id}/messages`, anna, { body: 'Борис, привет! Скинешь контакты до среды?' });

  // a memo sent for approval to the project manager
  const kinds = (await call('GET', '/document-kinds', secretary)) as { id: string; code: string }[];
  const memo = await call('POST', '/documents', anna, {
    kindId: (kinds.find((k) => k.code === 'MEMO') ?? kinds[0]).id,
    lang: 'ru',
    title: 'О закупке канцтоваров',
    data: { recipient: 'Директору центра', body: 'Прошу согласовать закупку канцтоваров на квартал.' },
  });
  await call('POST', `/documents/${memo.id}/submit`, anna, { route: [{ approverId: ids.manager }] });

  console.log('Demo data created.');
  console.log(`Sign in with any of: ${['admin → ' + ADMIN.login, ...PEOPLE.map((p) => p.login)].join(', ')}  (password: ${PASSWORD})`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
