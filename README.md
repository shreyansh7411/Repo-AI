# Repo AI

Repo AI is a repository-intelligence application for indexing source code and
answering questions about a repository. It combines a React/Vite frontend with
a TypeScript/Express backend, PostgreSQL metadata storage, deterministic code
graph analysis, and optional Gemini-powered embeddings and semantic search.

## What the application does

- Accepts repositories for indexing.
- Parses supported source files into files, symbols, chunks, and relationships.
- Stores repository metadata in PostgreSQL.
- Supports structural symbol and file lookup.
- Supports semantic and hybrid code search when embeddings are available.
- Provides caller/callee traces, impact analysis, and shortest dependency paths.
- Exposes a unified query API for symbol, file, search, trace, impact, and path
  requests.

Gemini is optional. Structural search, repository metadata queries, and graph
analysis do not require Gemini.

## Repository layout

```text
.
├── backend/                 TypeScript/Express API and indexing services
│   ├── src/                 API, parsers, ingestion, retrieval, and graph code
│   ├── .env.example         Safe configuration template
│   ├── package.json         Backend scripts and dependencies
│   └── tsconfig.json        TypeScript configuration
├── frontend/                React/Vite web application
│   ├── src/                 React components and styles
│   ├── public/               Static browser assets
│   └── package.json         Frontend scripts and dependencies
├── .gitignore               Repository-wide generated-file and secret rules
└── README.md                This documentation
```

The `backend/repositories/` directory contains repository fixtures and
reference projects used by indexing and analysis workflows. Its nested
projects may have their own build files and test resources.

## Requirements

- Node.js 22
- npm
- PostgreSQL
- The PostgreSQL `vector` extension for embedding/vector search features
- A Gemini API key only when using real embedding or Gemini generation features

## Configuration

The backend reads its runtime configuration from `backend/.env`.

Configure the values for the local PostgreSQL instance:

| Variable | Purpose | Default/example |
| --- | --- | --- |
| `PORT` | Backend HTTP port | `5000` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `repo-ai` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | Local secret |
| `DATABASE_URL` | Production PostgreSQL connection string; optional locally | Render PostgreSQL internal URL |
| `DB_SSL_MODE` | Production TLS policy: `disable`, `require`, or `verify-full` | `disable` locally; `require` for external database URLs |
| `CORS_ORIGIN` | Exact frontend origin allowed by production API | `https://<frontend>.onrender.com` |
| `REPOSITORY_STORAGE_PATH` | Absolute instance-local directory for cloned repositories | `backend/repositories` default locally; ephemeral in production |
| `GEMINI_API_KEY` | Gemini access key | Optional |
| `GEMINI_EMBEDDING_MODEL` | Embedding model | `gemini-embedding-2` |
| `GEMINI_GENERATION_MODEL` | Generation model | `gemini-3.8-flash` |
| `MAX_CONTEXT_CHARS` | Maximum generated context size | `24000` |

Never commit `backend/.env` or any other credentials. The root `.gitignore`
ignores `.env` files, passwords, API keys, certificates, private keys,
credential files, local databases, dependencies, logs, caches, and build
output. Share configuration changes by updating `.env.example`, not `.env`.

## Render deployment

The backend provides cookie-based authentication and scopes regular repository
APIs to the signed-in owner. Anonymous recruiter demos are a separate,
opt-in API and do not weaken authenticated repository ownership.

Create a Render PostgreSQL database, backend Web Service, and frontend Static
Site. Both package manifests require Node 22. For the backend, use build command
`cd backend && npm install && npm run build` and start command
`cd backend && npm start`. The backend listens on Render's `PORT` at
`0.0.0.0`. For the frontend, use build command
`cd frontend && npm install && npm run build` and publish directory
`frontend/dist`.

Set these backend environment variables in Render:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Render PostgreSQL internal URL when services share a region |
| `DB_SSL_MODE` | `disable` for Render's internal URL; `require` for external URL |
| `CORS_ORIGIN` | Exact HTTPS frontend origin, without a path or trailing slash |
| `AUTH_COOKIE_SAME_SITE` | `none` for Render-hosted frontend/backend origins |
| `REPOSITORY_STORAGE_PATH` | An absolute directory available to the backend instance |

This deployment uses Render's ephemeral filesystem and does not attach a
persistent disk. Clone directories are stored locally under
`REPOSITORY_STORAGE_PATH` and can disappear after a backend restart,
redeployment, or instance replacement. PostgreSQL stores repository and
indexed metadata, not Git working trees, so metadata can remain after clone
files disappear. Use a Render internal database URL for same-region traffic;
external PostgreSQL URLs require TLS.

Exactly one backend instance is required while repository storage is
instance-local. Multiple backend instances require genuinely shared clone
storage and coordinated deployment; PostgreSQL advisory locks alone do not
make instance-local clone directories shared.

Set the frontend build-time variable `VITE_API_BASE_URL` to
`https://<backend-service>.onrender.com/api`. Production CORS allows only the
configured frontend origin; local development retains permissive CORS.
For Render's `onrender.com` service domains, set
`AUTH_COOKIE_SAME_SITE=none`; production cookies are Secure and must allow
cross-site requests between the frontend and backend services.

### Anonymous recruiter demo

The public `/demo` page accepts public GitHub repository URLs and creates a
temporary, isolated workspace. The feature is disabled by default. To enable
it, set `DEMO_ENABLED=true` and generate `DEMO_RATE_LIMIT_SECRET` as a random
secret with at least 32 bytes. The remaining `DEMO_*` variables in
`backend/.env.example` control session lifetime, concurrent work, repository
size, file count, indexing duration, rate limits, and cleanup cadence.

Recommended starting settings are `DEMO_SESSION_TTL_MINUTES=120`,
`DEMO_MAX_ACTIVE_SESSIONS=10`, `DEMO_MAX_CONCURRENT_INDEXES=2`,
`DEMO_MAX_REPO_SIZE_MB=100`, `DEMO_MAX_INDEX_DURATION_SECONDS=180`,
`DEMO_MAX_FILES=2500`, `DEMO_MAX_FILESYSTEM_ENTRIES=25000`,
`DEMO_MAX_FILE_SIZE_MB=5`, a limit of 3 create attempts per IP per hour, 120
read requests per IP and per demo session per hour, and cleanup every 60
seconds. Tune these lower if the service or ephemeral filesystem is small.

Demo repositories have `owner_user_id = NULL` and a unique `demo_session_id`.
Their database rows and dependent files, symbols, relationships, chunks, and
embeddings are removed when the session expires or is ended. Demo embeddings
are not generated, so anonymous demo search is structural only. The backend
cleanup worker uses PostgreSQL advisory locks, but those locks do not share
instance-local clone files. Demo clones are stored under the `demo/`
subdirectory of `REPOSITORY_STORAGE_PATH`.

Production demo cookies use `HttpOnly`, `Secure`, `Path=/api/demo`, and
`SameSite=None` to work with a separately hosted frontend. Keep `CORS_ORIGIN`
set to the exact frontend origin. The cleanup worker starts automatically and
recovers expired, deleting, and abandoned indexing sessions after restarts,
even while `DEMO_ENABLED=false`. At startup, reconciliation invalidates
anonymous demo sessions whose clone directories are missing, including
interrupted indexing sessions without a repository record. Disabling demo mode
blocks session creation and access but does not pause cleanup.

Authenticated repository metadata can also remain after ephemeral clone
storage is lost. Such repositories lose clone-dependent functionality until
their source is cloned and indexed again; authenticated records are not
automatically deleted by demo cleanup.

Demo reads are limited by both the existing hashed-IP bucket and a persistent
per-session bucket. Session rate entries use the existing `demo_rate_limits`
table with an HMAC-derived key and are removed with expired rate-limit rows.
Clone size is checked against GitHub metadata before cloning, monitored during
cloning, and checked again after clone completion. Filesystem traversal has a
separate total-entry cap and cooperative deadline checks; individual database
operations are not forcibly interrupted.

Demo API:

```http
POST   /api/demo/session
GET    /api/demo/session
DELETE /api/demo/session
GET    /api/demo/repositories/{repositoryId}
GET    /api/demo/repositories/{repositoryId}/files?page=1&pageSize=100
GET    /api/demo/repositories/{repositoryId}/query/symbols?page=1&pageSize=50
POST   /api/demo/repositories/{repositoryId}/query/symbol
POST   /api/demo/repositories/{repositoryId}/query/file
POST   /api/demo/repositories/{repositoryId}/query/search
POST   /api/demo/repositories/{repositoryId}/trace/callers
POST   /api/demo/repositories/{repositoryId}/trace/callees
```

The create request body is `{"url":"https://github.com/owner/repository"}`.
It returns indexing counts and an HttpOnly cookie; the session token is never
returned to browser JavaScript. Demo search accepts `structural` only because
demo embeddings are not generated; semantic and hybrid modes are explicitly
unavailable. The authenticated search APIs retain their existing modes.
Each repository request verifies the cookie's session owns the repository;
foreign or authenticated-user repositories return not found.

Initialize or upgrade the PostgreSQL database before serving application
traffic. Run `cd backend && npm run db:migrate` as a Render pre-deploy command
or manually against the production database. The migration runner discovers
the numbered migration files and applies pending migrations in order,
transactionally; production must complete migrations 001 through 006 before
the new backend receives traffic. The command enables PostgreSQL's `vector`
extension first. The database user must have permission to create the
extension.

### Authentication and repository ownership

The backend provides `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/auth/logout`, and `GET /api/auth/me`. Sessions are signed JWTs held
in HttpOnly cookies. All `/api/repositories` routes require authentication;
repository list, creation/indexing, lookup, and deletion are scoped to the
authenticated user. The browser must send credentialed requests to the API.

Migration `004_repository_ownership.sql` adds a nullable `owner_user_id` and
index without changing or deleting existing repository data. Legacy rows remain
inaccessible through repository APIs until assigned by the trusted operator.
After creating the original account, the operator can get its UUID from the
registration response or `users` table, set `LEGACY_REPOSITORY_OWNER_ID` in the
backend environment, and run `cd backend && npm run db:assign-legacy-owner`.
That one-time command assigns only rows whose owner is still NULL and requires
the selected UUID to exist in `users`. Remove the temporary variable afterward.
Public registrants cannot invoke this bootstrap operation.

## Core capabilities

The backend exposes repository ingestion under `/api/repositories` and a
health endpoint under `/api/health`.

### Embeddings and semantic search

Generate missing embeddings for a repository:

```http
POST /api/repositories/{repositoryId}/embeddings
```

Search embedded chunks:

```http
POST /api/repositories/{repositoryId}/search
Content-Type: application/json

{"query":"payment validation flow","limit":5}
```

The search limit defaults to 5 and is capped at 50. Embeddings are generated
in batches, and failed chunks remain retryable.

### Trace and impact analysis

Supported relationship types are `CALLS`, `IMPORTS`, `IMPLEMENTS`, and
`EXTENDS`. Traversal is breadth-first, repository-scoped, cycle-safe, and
deterministic.

```http
POST /api/repositories/{repositoryId}/trace/callers
{"symbolId":"<symbol-uuid>","maxDepth":2}

POST /api/repositories/{repositoryId}/trace/callees
{"symbolId":"<symbol-uuid>","maxDepth":2}

POST /api/repositories/{repositoryId}/impact
{"symbolId":"<symbol-uuid>","maxDepth":2}

POST /api/repositories/{repositoryId}/trace/path
{"fromSymbolId":"<symbol-uuid>","toSymbolId":"<symbol-uuid>","maxDepth":5}
```

Trace and impact depth values are limited to 1–5. Path requests can also
provide a non-empty `relationshipTypes` array.

### Unified repository query API

```http
POST /api/repositories/{repositoryId}/query/symbol
{"symbolId":"<symbol-uuid>"}

POST /api/repositories/{repositoryId}/query/file
{"path":"src/main/java/example/Service.java"}

POST /api/repositories/{repositoryId}/query/search
{"query":"How does payment reconciliation work?","mode":"hybrid","topK":5,"maxDepth":1}

POST /api/repositories/{repositoryId}/query/trace
{"symbolId":"<symbol-uuid>","direction":"callers","maxDepth":2}

POST /api/repositories/{repositoryId}/query/impact
{"symbolId":"<symbol-uuid>","maxDepth":2}

POST /api/repositories/{repositoryId}/query/path
{"fromSymbolId":"<symbol-uuid>","toSymbolId":"<symbol-uuid>","maxDepth":5}
```

Search modes are `semantic`, `structural`, and `hybrid`. Structural modes
remain usable without Gemini. Hybrid graph expansion is capped at depth 2.

## Database notes

PostgreSQL stores repository records, files, symbols, relationships, code
chunks, and optional vector embeddings. Ensure the configured database exists
and that required migrations/schema setup has been applied before exercising
ingestion or query endpoints. Semantic search requires vectors generated after
indexing; structural and graph queries do not.
