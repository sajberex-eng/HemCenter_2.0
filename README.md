# HemCenter 2.0

Система коммуникаций и проектного офиса АУП центра гематологии (Казахстан): собственный мессенджер вместо WhatsApp, проекты и ответственность, протоколы и приказы, контроль исполнения.

Требования — `docs/TZ.md`, обоснование решений — `docs/research.md`, этапы — `docs/roadmap.md`.

**Состояние:** этапы 1–4 реализованы и проверены автотестами на тестовых данных: вход, роли, двухфакторная защита, мессенджер с уведомлениями и поиском, импорт из WhatsApp, проекты, задачи, решения, загрузка сотрудников, документы по шаблонам Word с согласованием, регистрацией и PDF, совещания и протоколы, поручения с контролем исполнения, панель руководителя, журнал аудита, резервные копии. Подготовка пилота — `docs/pilot-plan.md`; установка и эксплуатация — `docs/operations.md`; памятка сотрудника — `docs/user-guide.md`. Открытые вопросы к заказчику: `docs/decisions-needed.md`.

## Локальная разработка

Нужны Node.js 22, pnpm 10 и PostgreSQL 16.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # укажите DATABASE_URL и JWT_SECRET (32+ символа)
pnpm --filter @hemcenter/shared build
cd apps/api && npx prisma migrate dev && pnpm db:seed   # создаст администратора, пароль напечатает один раз
pnpm dev:api    # http://localhost:4000/api
pnpm dev:web    # http://localhost:3000  (запросы /api проксируются на API_URL, по умолчанию localhost:4000)
```

## Проверки

```bash
pnpm --filter @hemcenter/api test      # API-тесты на реальной БД hemcenter_test (создайте её заранее)
pnpm --filter @hemcenter/api lint      # проверка типов
pnpm --filter @hemcenter/web lint
```

Браузерные тесты (`e2e/`, Playwright) запускаются отдельно против поднятых API и веб-приложения:

```bash
cd apps/api && ADMIN_LOGIN=e2e-admin ADMIN_PASSWORD=E2e-admin-pass-1 ADMIN_MUST_CHANGE=false pnpm db:seed
# API нужно запускать с DISABLE_THROTTLE=true REQUIRE_ADMIN_TOTP=false — иначе лимит 10 входов в минуту прервёт тесты,
# а администратору потребовались бы одноразовые коды 2FA
cd e2e && npx playwright test
```

## Развёртывание (Docker)

```bash
cp infra/.env.example infra/.env    # задайте DB_PASSWORD, JWT_SECRET, DOMAIN
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
docker compose -f infra/docker-compose.yml --env-file infra/.env exec api node dist/cli/create-admin.js
```

Данные хранятся в томе `dbdata`; сервер должен находиться на территории Республики Казахстан.
