# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

HemCenter 2.0 is a communication and project-office system for the administrative staff of a private hematology center in **Kazakhstan**. It replaces WhatsApp groups.

- `docs/TZ.md` is the source of truth for requirements (acceptance scenarios are labelled `П-x.x.x`); `docs/research.md` explains the decisions; `docs/roadmap.md` lists the stages.
- **Stages 1-4 are implemented and tested on test data; stage 5 (pilot preparation) is mostly done.** Messenger (chats, search, pins, attachments, Web Push, WhatsApp import), projects/tasks/decisions/workload, documents (Word templates, approval, scans, registration), meetings/protocols, assignments with reports and reminders, head's dashboard, audit screen with export, system status, encrypted backups with a restore drill, load test. See the sections below and `docs/roadmap.md`. What still needs the centre's IT side is listed in `docs/operations.md` section 8 (real servers in Kazakhstan, Docker build, push on real phones, Kazakh proofreading, legal texts).

- **Open decisions live in `docs/decisions-needed.md`.** Append there whenever something only the owner can decide comes up; do not block on it. Proceed with a documented default and say so.

## Commands

pnpm workspace (`apps/api`, `apps/web`, `packages/shared`). `@hemcenter/shared` compiles to `dist/` and must be built before the apps: `pnpm --filter @hemcenter/shared build`.

- API dev / tests: `pnpm dev:api`; `pnpm --filter @hemcenter/api test` (vitest + supertest on a real PostgreSQL database `hemcenter_test`, migrations applied automatically; one test: `-- -t "name"`).
- Type check: `pnpm --filter @hemcenter/api lint`, `pnpm --filter @hemcenter/web lint`.
- DB: `cd apps/api && npx prisma migrate dev` (schema in `prisma/schema.prisma`); first admin: `pnpm db:seed` (`src/cli/create-admin.ts`).
- Web dev: `pnpm dev:web`. The browser calls `/api/*` on its own origin; Next rewrites it to `API_URL`, so the SameSite=Strict refresh cookie works.
- Browser tests: `e2e/` (Playwright, outside the workspace). Start the API with `DISABLE_THROTTLE=true REQUIRE_ADMIN_TOTP=false`, otherwise the 10 logins/minute limit makes the suite fail with 429, and admin sign-ins would need single-use TOTP codes.

## Stack notes

- Monorepo: `apps/web` (Next.js PWA, kk/ru i18n), `apps/api` (NestJS, REST, Prisma), `packages/shared`, `infra/` (Docker Compose, Caddy), `templates/` (DOCX). Still to come: Socket.IO chat, file attachments stored on a disk volume (decision: no MinIO; keep storage behind an interface; files are served only through the API after permission checks), docxtemplater **core only** (its paid modules are off-limits) for DOCX templates, Gotenberg for PDF.
- **Prisma is pinned to 6.x.** The unpinned `prisma` package currently resolves to an 8.x release candidate with a different CLI. **TypeScript is pinned to 5.x** for Nest decorators.
- **Next.js here is 16**, and `node_modules/next/dist/docs/` is the authoritative documentation (APIs differ from older versions; `middleware` is now `proxy`).
- Auth: short-lived access JWT (Bearer, kept in memory in the browser) plus a rotating httpOnly refresh cookie with reuse detection (a token that was ROTATED less than 10 s ago is still honoured: a reload can lose the new cookie, two tabs can race; a token closed by logout or revocation never is, and a later replay burns all sessions). Roles and `isActive` are re-read from the database on every request; `tokenVersion` invalidates access tokens when roles change, a user is blocked or logs out everywhere.
- **Messenger rules**: a non-member (administrators included) gets 404 for a chat, except users with the MANAGEMENT role in the explicit "management view" (decided 02.10.2026: read-only, every opening is written to the audit log, chat members see a badge, consent is part of the PD consent form); sending does not advance the author's read pointer (no false read receipts); push notifications carry only the sender's short name and chat id, never text or file names; alerts (toast/sound) are decided only once the chat and do-not-disturb settings are known; attachments are served only through the API, type decided by content, executables/scripts/web pages blocked; ARCHIVE chats (imported history) are read-only everywhere (`ChatsService.assertWritable`) and the importing administrator is not a member.
- **Tests worth knowing**: API tests need the `hemcenter_test` database and run with `REQUIRE_ADMIN_TOTP=false`, `DISABLE_THROTTLE=true`, a temp `FILES_DIR` and throwaway VAPID keys (see `vitest.config.ts`). Browser tests need the API started with real VAPID keys and a `FILES_DIR`; they pin a UTF-8 locale because Chromium in a container without one saves non-Latin download names as "download". Several tests were mutation-checked; keep them meaningful.
- 2FA (TOTP): mandatory for ADMIN and MANAGEMENT (`REQUIRE_ADMIN_TOTP`, default on; admin endpoints return 403 `MFA_SETUP_REQUIRED` until enrolled). Secrets are AES-256-GCM encrypted (`TOTP_KEY`, falls back to `JWT_SECRET`). A code works once per 30 s step. Wrong codes share the password lockout counter, and the password step must NOT reset it. API tests and e2e servers run with `REQUIRE_ADMIN_TOTP=false` except in `test/totp.e2e.ts`.
- `AuditLog` is append-only, enforced by a PostgreSQL trigger; tests clear it with `TRUNCATE`.
- The Docker files in `infra/` and `apps/*/Dockerfile` have not been built in the development environment (no Docker daemon there).

## Project office (stage 3)

- Code: `apps/api/src/projects/` (rules in `project-rules.ts`, services for projects, tasks, decisions, workload); UI under `apps/web/app/(app)/{projects,tasks,workload}` and `components/work/`.
- A project owns a GROUP chat (`Project.chatId`); the team is the chat membership, so team changes go through the project (`PROJECT_CHAT_MANAGED` refuses them in the chat). Visibility: team, manager, curator, ADMIN/MANAGEMENT; everyone else gets 404. Creating projects: ADMIN, MANAGEMENT, PROJECT_MANAGER.
- Tasks and decisions travel inside `MessageDto` (`tasks`, `decision`) and are refreshed to the chat with the existing `message:updated` event (`MessagesService.broadcastUpdate`). One decision per message. Decision status is derived: any objection → OBJECTIONS; everyone answered → CONFIRMED; else PENDING. Objection needs a comment.
- Workload counts PLANNED and ACTIVE projects only; above 100% is flagged. Dates are calendar dates (`@db.Date`), "today" is taken in `APP_TIMEZONE`. DTO class fields exist with value `undefined`, so inspect values, not `Object.keys`.

## Documents (stage 4)

- Code: `apps/api/src/documents/`. Kinds (`DocumentKind`: protocol, order, memo, directive built in; the secretary adds more) and templates (`DocumentTemplate`, versioned per kind and language, Word files on the `FileStorage` disk) are created by `KindsTemplatesService.ensureDefaults()` at start-up (tests call `seedDocuments(app)` after `resetDb`). Built-in templates are generated in code (`default-templates.ts`, `docx-builder.ts`) because the centre gave no samples.
- Filling is docxtemplater core + pizzip (`render.ts`): values are text, never markup; a template must fill cleanly with full sample data or the upload is refused (`TEMPLATE_INVALID` with `details`). Fields: `org title number date author preamble body recipient signer chair secretary`, lists `participants agenda decisions items approvals` (with `n`), switches `hasX`.
- PDF: `PdfConverter` is Gotenberg when `GOTENBERG_URL` is set, otherwise local LibreOffice (`soffice`, needs the **libreoffice-writer** package; `libreoffice-core` alone fails with "source file could not be loaded"). The PDF is made on first download, cached by key, and its SHA-256 is stored; editing the text clears both files. Not verified here: Gotenberg in Docker, and the look of the PDF (only that fonts embed and the text is there).
- Visibility of a document: author, everyone in its route, SECRETARY, ADMIN, MANAGEMENT. Anyone can draft; only the author edits, and only in DRAFT/RETURNED.
- Life cycle: DRAFT → IN_REVIEW → (RETURNED → resubmit, round+1) → APPROVED → SIGNED (scan of the paper copy uploaded) → REGISTERED (number `N-PREFIX/YYYY`, counter per kind and year in `RegistryCounter`). Route = `ApprovalStep`s; same `stage` = parallel, stages in order (`approval-rules.ts`). Returning needs a comment and ends the round for everyone. The approval sheet is `ApprovalAction` (append-only, also printed into the file). Every state change takes `lockDocument` (row lock) in a transaction and clears the generated files; registration also makes the final PDF and its hash. Registered documents never change (`PREFIX_LOCKED` keeps printed numbers valid). Event `document:updated` drives the menu badge (`useAwaitingDocs`) and open pages.

## Meetings (stage 4c)

- Code: `apps/api/src/meetings/` (pure `meeting-rules.ts` builds the protocol text), UI `apps/web/app/(app)/meetings`. A meeting owns a GROUP chat (like a project); participants = chat members, changed only through the meeting (`PROJECT_CHAT_MANAGED` also covers meeting chats). Agenda `MeetingItem` (+ "heard" text) with `MeetingResolution`s: DECISION (text, may be taken over from a decision made in the meeting chat) or INSTRUCTION (responsible participant + due date both required).
- Editing: creator, chair, meeting secretary, ADMIN. Seeing: participants plus SECRETARY/ADMIN/MANAGEMENT. `makeProtocol` creates (or refreshes) one protocol `Document` per meeting (`Meeting.protocolId`), which then follows the ordinary approval/registration flow; once it is IN_REVIEW or later the record is locked (`PROTOCOL_LOCKED`), after a return it opens again.

## Execution control (stage 4d)

- Code: `apps/api/src/assignments/` (rules in `assignment-rules.ts`), `notifications/`; UI `apps/web/app/(app)/{assignments,notifications}`. `Assignment` = text, one responsible (+ co-responsible), a controller, due date (`originalDue` kept when moved). Status NEW → IN_PROGRESS → REVIEW (report sent) → DONE (accepted) or RETURNED (needs a comment) or REMOVED (reason). **Overdue is derived** (still with the responsible person and due before today), a report waiting for the controller is not late. Every transition locks the row (`FOR UPDATE`) and writes `AssignmentEvent` (history) + audit.
- Where assignments come from: registering a document (`RegistryService.register` → `AssignmentsService.createForDocument` inside the same transaction: every `DocData.items` entry with `responsibleId` and `due`; controller = the meeting's chair for a protocol, else the document's author; idempotent per `(document, item index)`); by hand (ADMIN, MANAGEMENT, PROJECT_MANAGER, SECRETARY); from a chat message (same roles, responsible must be in the chat).
- Reports carry up to 5 files (`ReportFile` on `FileStorage`, same blocked-extension rules). Due-date change = request with a reason, one pending at a time, decided by the controller.
- Notifications: `Notification` rows (type + assignment id only, no text of the work) + realtime `notification:new` + generic push (`PushService.notifyEvent`, texts in `PUSH_TEXT`). Reminders (`ReminderScheduler`, hourly; off with `DISABLE_SCHEDULER=true`, tests set it): 3 days, 1 day, the day, then daily when late (the controller also hears of late ones), at most once per kind per day (`ReminderLog`). Head's overview: `GET /assignments/summary` (ADMIN/MANAGEMENT).

## Operations (stage 5)

- `infra/backup/` (`backup.sh`, `restore.sh`, `verify-restore.sh`, `lib.sh`, `test-backup.sh`): gpg-encrypted bundle of `pg_dump` + files + `counts.txt` + checksums; the drill restores into a scratch database and compares every table's row count and the files. Run `infra/backup/test-backup.sh` (needs `DATABASE_URL`, `FILES_DIR`, createdb rights) after touching them. Compose profile `tools` has `backup`/`restore` services; `gotenberg` is a normal service. None of this has been run under Docker here.
- `apps/api/scripts/loadtest.ts` (50-100 sockets in one group, measures delivery latency; use a test database). `GET /system/status` + `/admin/system` (disk warning below 20 %, alarm below 10 %). `GET /dashboard` (ADMIN/MANAGEMENT).
- The audit API deliberately never returns the `data` column (it holds previous message texts and other content); the text stays in the database only. Keep it that way.
- Docs for people: `docs/operations.md` (IT), `docs/user-guide.md` (employees, ru), `docs/pilot-plan.md`.

## Core domain idea

"A chat that documents are born from." Any chat message can become one of:
- a **Task** — exactly one responsible person, required;
- a **Decision** — addressees confirm it with Agree / Object (comment required) / Acknowledged;
- an **Assignment** — an instruction tracked for execution.

Decisions and assignments flow into meeting **Protocols** and **Orders**, which are generated from DOCX templates. These go through an approval route, then a registry journal assigns a unique sequential number. Each assignment then goes through execution control: report → acceptance. Each of these objects keeps a link back to its source message and chat.

## Hard constraints

- **Data residency:** all data, backups and logs stay on servers in Kazakhstan (Law №94-V, art. 12). Do not add external SaaS for content, analytics, email or file storage.
- **Push notifications carry no message or document content** (only "New message from X"), because they go through Google and Apple push services.
- **Bilingual:** every UI string and document template has Kazakh (`kk`) and Russian (`ru`) versions. No hardcoded UI text.
- **Audit log is append-only.** Edits and deletions of messages keep the original version in the log.
- **Permissions are checked server-side** on every request, including file downloads.
- **No digital signature (ЭЦП) in the first release.** Documents are signed on paper and the scan is uploaded. Keep an immutable PDF and its hash per document, so NCALayer/NCANode signing can be added later.
- **No patient data:** this is an administrative system, and the UI warns users not to post patient information.
