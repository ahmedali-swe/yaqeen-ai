# Yaqeen | يقين

**للمعنى أمانة. وللدليل مسار.**

Yaqeen is the foundation of an Arabic-first Islamic content verification
platform. Its intended core is to trace how a claim changes between its
original evidence and published content, identify semantic distortion, and
eventually propose an evidence-preserving correction: **Yaqeen Patch**.

This repository implements the project foundation only. **There is no AI
verification, extraction, OCR, retrieval, source ingestion, or generated
correction.** No fake reports or seeded religious sources are included.

## Current scope

- Responsive Arabic RTL homepage with text and image input modes.
- Text validation (nonempty, maximum 10,000 UTF-16 code units); local image
  selection (PNG/JPEG/WebP, nonempty, maximum 5 MiB).
- The **تحليل المحتوى** button validates locally and opens `/analysis` with
  five explicit empty sections: extracted claims, source/evidence, evidence
  trail, meaning changes, and Yaqeen Patch.
- The button **does not analyze, upload, persist, or transmit the input**.
  Input stays in component memory and is discarded when leaving the form.
  Opening `/analysis` directly also shows the empty page. No report ID or
  verification judgment is fabricated.
- Typed domain models, environment validation, a lazy server-only PostgreSQL
  pool, transactional migrations, pgvector, and an empty approved-source registry.
- Accessible labels, keyboard focus, skip navigation, reduced-motion support,
  error/not-found pages, basic security headers, unit and component tests.

No chatbot, authentication, microservices, MCP, fine-tuning, or AI provider
dependencies are included. Public write/upload APIs are intentionally absent.
The foundation can be built and deployed as a static UI within a Next.js server;
enabling real verification and public persistence is future work.

## Architecture

A single Next.js App Router application uses TypeScript, React, Tailwind CSS 4,
pnpm, and PostgreSQL 17 with pgvector. Server components render pages; one client
component handles ephemeral input. It has no request to a verification backend.

```text
Arabic RTL pages → local input validation → empty results page
                  (no persistence or verification)

Future server features → server-only pg pool → PostgreSQL + pgvector
                       → approved-source boundary (currently empty)
```

`src/domain/analysis.ts` defines `Claim`, `Evidence`, `SourceReference`,
`EvidenceRelation`, `MutationType`, `VerificationStatus`, `YaqeenPatch`, and
`AnalysisReport`. Processing status is separate from verification status. A
claim's verification status is nullable until a real judgment exists.
`EvidenceRelation` preserves original and published text and can reference a
preceding relation in the same report. Future processing must additionally
enforce acyclic trails and reviewed, evidence-supported patches.

SQL uses UUIDs, foreign keys, enum types, relational patch/evidence links and
checks for spans, completion timestamps, and embedding/model pairs. SQL snake
case maps to domain camel case; no repositories or row mappers are implemented
yet. Reports aggregate related records rather than storing duplicate JSON.
Embedding dimensions and vector indexes are deferred until a model is chosen;
the nullable `vector` column preserves that choice without fabricated embeddings.

## Prerequisites

- Node.js **22.13+** (Node.js 24 LTS recommended).
- pnpm **10.18.3**, as pinned in `packageManager`.
- Docker Engine/Desktop with Compose v2, **or** PostgreSQL 17 with the pgvector
  extension installed and permission to enable it.
- Internet access for the initial dependency install. No external font or AI
  service is needed at runtime or during builds.

On Windows, use `npm.cmd`/`pnpm.cmd` when PowerShell blocks `.ps1` shims.

## Installation

From the repository root:

```sh
npm install --global pnpm@10.18.3
pnpm install --frozen-lockfile
```

If you prefer no global pnpm installation:

```sh
npm exec --yes --package=pnpm@10.18.3 -- pnpm install --frozen-lockfile
```

Use the same `npm exec ... -- pnpm` prefix for the commands below. Dependency
versions and the lockfile are committed. Only `esbuild` and `unrs-resolver` are
allowed dependency build scripts in the `pnpm` configuration in `package.json`.

## Environment variables

Copy the example before running database commands:

```sh
cp .env.example .env.local
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env.local
```

| Variable | Purpose | Requirement/default |
| --- | --- | --- |
| `DATABASE_URL` | Server-side PostgreSQL connection URI | Required by database commands and `getDb()`; optional for the static UI |
| `APP_URL` | Validated app URL, reserved for future server links | HTTP(S); defaults to `http://localhost:3000` |
| `DB_POOL_MAX` | Maximum pool connections per Node process | Integer 1–20; defaults to 5 |
| `POSTGRES_USER` | Local Compose database user | Required by Compose |
| `POSTGRES_PASSWORD` | Local Compose database password | Required by Compose; example is local-only |
| `POSTGRES_DB` | Local Compose database name | Required by Compose |
| `POSTGRES_PORT` | Local host port | Defaults to 5432 |

Keep `DATABASE_URL` consistent with the Compose variables; percent-encode
special characters in URI credentials. The app and CLI scripts load Next.js
environment files. Compose loads the file explicitly through `--env-file`.

```sh
pnpm env:check
```

This validates configuration without connecting. Supplied invalid environment
values fail server startup. Static builds and the empty UI do not require a
database or secrets. Database operations always require a valid database URL.

## Database setup

```sh
docker compose --env-file .env.local up -d --wait
pnpm env:check
pnpm db:migrate
pnpm db:check
```

Compose uses `pgvector/pgvector:0.8.6-pg17`, binds only to `127.0.0.1`, and retains
data in the `yaqeen_pgdata` volume. The migrator enables `vector` and creates the
empty schema; there are **no seeds**. Initialization is explicit, not hidden in
application startup.

The migrator runs all pending SQL files in one transaction under an advisory
lock, records SHA-256 checksums, and skips unchanged applied migrations. Add a
new numbered migration for schema changes; never edit a migration already
applied to a shared database. A failed run rolls back its changes. Take backups
and review migration permissions before applying to an existing database.

`db:check` checks connectivity, all foundation tables, and a pgvector distance
operation without writing records. To use an existing PostgreSQL instance,
install pgvector there, set `DATABASE_URL`, then run the same migration/check
commands. Use a migration role permitted to create the extension; a future app
runtime role should have only the permissions its features need.

```sh
docker compose --env-file .env.local stop
```

Changing a Compose password does not change credentials in an already
initialized volume. Update existing database credentials explicitly. Do not
delete the database volume to solve configuration errors if it holds useful data.

## Local development

```sh
pnpm dev
```

Open `http://localhost:3000`. `/analysis` is an empty results page. The database
may remain stopped while working on the current UI. System Arabic font fallbacks
avoid build-time font downloads.

## Build and production run

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`start` serves the production build on port 3000. Terminate with Ctrl+C.
Set environment values through your deployment's secret manager. Serve over
HTTPS and configure managed PostgreSQL TLS using its documented connection
parameters; the pool never disables certificate verification explicitly.

## Testing

```sh
pnpm test
pnpm test:watch
```

Vitest and Testing Library cover environment validation and secret-safe errors,
text/image boundaries, form mode changes, rejected inputs, navigation without
content in the URL, and all five honest empty result sections. File bytes used
in component tests are synthetic fixtures only; they are never seeded into the
app or database. Image checks are browser UX checks, not a future server upload
security boundary.

ESLint and Next-generated TypeScript route checks run independently from
`next build`. The CI workflow runs these checks and a production build, plus
migration replay and `db:check` against an ephemeral pgvector database.
Database checks require a real server; unit/component tests and builds do not.

## Project structure

```text
src/
  app/                    # RTL layout, homepage, empty analysis, errors, styles
  components/             # Shared shell, input form and empty-state sections
  domain/analysis.ts      # Domain entities and exact verification vocabulary
  lib/                    # Environment, input validation, server-only pg pool
  sources/                # Empty approved registry, types and approval policy
  instrumentation.ts      # Startup environment validation
db/migrations/            # Versioned SQL schema; no seeds
scripts/                  # Environment check, migration runner, DB check
tests/                    # Unit and component tests
.github/workflows/        # CI validation with PostgreSQL + pgvector
compose.yaml              # Local database with persistent volume
.env.example              # Documented local configuration
pnpm-lock.yaml            # Reproducible dependencies
```

## Approved Islamic sources

Read [`src/sources/README.md`](src/sources/README.md) before extending the source
boundary. The registry is deliberately empty. Approval requires a named
reviewer, canonical location, edition, scope, provenance and permitted-use notes.
No source has been approved or ingested by this project. Future ingestion must
preserve exact passages, context and stable locators, and synchronize approved
registry entries with the database deliberately.

## Security and secrets

- `.env*` is ignored except `.env.example`. Never commit real credentials or put
  them in `NEXT_PUBLIC_*`, URLs, UI messages or logs.
- The provided password and localhost port mapping are for local development
  only. The Compose file is not a production database deployment.
- Inputs stay in browser memory and are not logged, stored in local/session
  storage, uploaded, or sent in query parameters. There is no analytics SDK.
- Database access is server-only. Keep future queries parameterized and keep
  user-provided content out of SQL strings and raw HTML.
- Before enabling public input persistence, add server-side validation, upload
  inspection, abuse limits, consent/retention controls and access controls.
- Basic response headers are included. Deployment-specific CSP, TLS, backup,
  monitoring and credential rotation policies remain deployment work.
- This foundation provides no religious verdicts; a future verification engine
  must communicate uncertainty and route specialist cases for qualified review.

## Stack references

Configuration follows the official [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation),
[Tailwind CSS Next.js guide](https://tailwindcss.com/docs/installation/framework-guides/nextjs),
and [pgvector documentation](https://github.com/pgvector/pgvector).
