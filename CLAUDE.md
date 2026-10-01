# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

HemCenter 2.0 is a communication and project-office system for the administrative staff of a private hematology center in **Kazakhstan**. It replaces WhatsApp groups.

The repo currently holds only the specification:
- `docs/TZ.md` — requirements, the source of truth. Acceptance scenarios are labelled `П-x.x.x`.
- `docs/research.md` — why we build our own app, the open-source components chosen, and Kazakhstan's legal requirements.
- `docs/roadmap.md` — delivery stages.

No code exists yet. When stage 1 adds code, add the real build, lint and test commands here.

## Planned stack (TZ §5)

Monorepo layout: `apps/web` (Next.js PWA, kk/ru i18n), `apps/api` (NestJS, REST + Socket.IO, Prisma), `packages/shared`, `infra/` (Docker Compose, Caddy), `templates/` (DOCX templates).

Supporting services:
- PostgreSQL;
- MinIO for file storage;
- docxtemplater **core only** (its paid modules are off-limits) to fill DOCX templates;
- Gotenberg to convert DOCX to PDF.

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
