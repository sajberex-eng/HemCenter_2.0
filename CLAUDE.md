# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

HemCenter 2.0 is in the concept stage: there is no source code, build system, linter or test suite yet. The only substantive content is `docs/HemCenter_AI_agents_concept.docx` (in Russian), which defines the target system. When code is added, update this file with the real build/lint/test commands.

To read the concept doc without extra tooling:

```bash
python3 -c "import zipfile,re;x=zipfile.ZipFile('docs/HemCenter_AI_agents_concept.docx').read('word/document.xml').decode();[print(t) for p in re.findall(r'<w:p[ >].*?</w:p>',x,re.S) if (t:=''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>',p))).strip()]"
```

## What the system is

A cloud management system for a hematology center (Russia) in which AI agents act as "digital employees" for **administrative** functions only: HR, sales/marketing/CRM, economics and finance, procurement/SRM/warehouse, and internal audit. Clinical tasks are explicitly out of scope.

## Target architecture (from the concept doc)

- **Web portal** with roles: management, departments, the human owner of each agent.
- **Backend API**: business logic, access control, and the **tool layer** agents use.
- **PostgreSQL**: employees, contracts, suppliers, warehouse, finance.
- **Agent runtime**: agents, a task queue, a scheduler for recurring checks.
- **Audit log**: append-only record of every action by people and agents.

Agent hierarchy: a **Coordinator agent** routes requests, tracks deadlines and builds summaries, but approves nothing. Domain agents (HR, sales/marketing, economics/finance, procurement/SRM/warehouse) sit under it. The **Internal audit agent is independent of the Coordinator** and reports directly to humans; it also checks other agents' actions. Do not wire audit through the coordinator.

## Design rules future code must respect

- **No direct DB access for agents.** Agents call narrow tools via an API or MCP server (examples from the doc: `get_stock(item)`, `create_purchase_draft(...)`, `list_expiring_accreditations(days)`).
- **Least privilege per agent** (e.g. marketing cannot see salaries, HR cannot see payments).
- **Read/write separation:** analytics reads from a replica or analytics store; agent writes only create drafts or set an "awaiting approval" status.
- **Three permission tiers:** the agent acts alone (data gathering, drafts, reminders, reports); the agent proposes and a human approves (commercial offers, purchase requests, candidate invitations); human only (signing contracts, payments, hiring and firing).
- **Every agent has a named human owner**, and every proposal carries the data and reasoning behind it (explainability). The UI's approval actions are Approve / Reject / Return for revision.
- **Personal data (152-FZ):** data sent to an LLM must be de-identified (full names and SNILS replaced with IDs). Storage must be in the Russian Federation. Under art. 16 of 152-FZ, HR decisions cannot be fully automated: agents rank and prepare, humans decide.
- **Regulatory values are data, not code:** 44-FZ/223-FZ thresholds, KOSGU budget codes and OMS/KSG/VMP tariffs live in reference tables, confirmed by the center's economist and lawyer.
- **Every agent action is written to the audit log.**

## Planned rollout order

1. Warehouse and procurement forecasting, SRM, HR record-keeping, Executive analyst
2. Economist, Financier, Contract service, Internal audit
3. Sales manager, Marketing, CRM, Insurance (OMS/DMS)

Domain terms used throughout: 44-FZ/223-FZ (public procurement laws), NMCK (initial maximum contract price), EIS (unified procurement information system), KOSGU (budget classification codes), FHD (financial and business activity plan), OMS/DMS (compulsory and voluntary health insurance), KSG (clinical-statistical groups, the basis for tariffs), VMP (high-tech medical care), NMO (continuing medical education credits).
