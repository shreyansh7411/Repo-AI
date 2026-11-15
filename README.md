# Repo AI

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Open%20Repo--AI-7048d7?style=for-the-badge)](https://repo-ai-frontend.onrender.com)

Repo-AI is a repository intelligence workspace for indexing source code and
exploring repository structure with evidence from the indexed source. It
combines a React 19/Vite frontend, a TypeScript/Express API, PostgreSQL with
pgvector, Tree-sitter parsing, deterministic graph analysis, and optional
Gemini-powered embeddings and retrieval.

## What the application does

- Create an account, add a Git repository, and index it in an owner-scoped workspace.
- View indexed repository metadata and counts on the Dashboard.
- Browse indexed files and symbols, inspect declarations and source context, and follow direct callers/callees.
- Search indexed code structurally or with hybrid retrieval; API clients can also request semantic-only retrieval.
- Explore bounded, directed shortest paths across selected relationship types.
- Use deterministic trace and impact APIs to inspect graph-derived dependencies.
- Try a temporary, isolated demo with a public GitHub repository, without an account.

Impact Analysis and the AI Assistant have backend APIs, but their authenticated
frontend pages are placeholders. Structural search, symbol browsing, caller /
callee exploration, Path Explorer, and repository metadata queries do not
require Gemini. Semantic retrieval requires an available Gemini provider and
stored embeddings; coverage may be incomplete.

The authenticated sidebar groups Dashboard, Search, Symbols, and Path Explorer
under Explore. Caller/callee panels are part of Symbols. Impact Analysis and
AI Assistant are listed separately as coming soon. The `/callers` URL remains
available as a compatibility route to the Symbols workspace.

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

## Local setup

1. Install Node.js 22 and PostgreSQL with the `vector` extension available.
2. Create a local database and configure `backend/.env` using
   `backend/.env.example`. At minimum, configure local database access and a
   random `AUTH_JWT_SECRET` of at least 32 bytes.
3. Apply the database migrations and start the API:

   ```sh
   cd backend
   npm install
   npm run db:migrate
   npm run dev
   ```

4. In a second terminal, configure `frontend/.env` with
   `VITE_API_BASE_URL=http://localhost:5000/api`, then start the frontend:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

The frontend uses credentialed requests for HttpOnly cookie authentication.
The backend's local CORS configuration permits development origins; production
requires an exact configured frontend origin. Use `npm run db:migrate` from
`backend` to apply pending migrations in order. The runner enables pgvector
before schema migrations; the database role must be allowed to create the
extension.

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
| `DATABASE_URL` | Production PostgreSQL URL; optional locally | Set in production |
| `DB_SSL_MODE` | Production TLS: `disable`, `require`, or `verify-full` | `disable` locally |
| `CORS_ORIGIN` | Exact allowed production frontend origin | Local default in `.env.example` |
| `REPOSITORY_STORAGE_PATH` | Absolute path used for cloned repositories | Local default is `backend/repositories` |
| `AUTH_JWT_SECRET` | Signing secret for cookie sessions (32+ bytes in production) | Generate locally; never commit |
| `AUTH_COOKIE_SAME_SITE` | Cookie policy: `lax`, `strict`, or `none` | `lax` locally; `none` for cross-site Render services |
| `GEMINI_API_KEY` | Enables real Gemini embedding and generation requests | Optional |
| `GEMINI_EMBEDDING_MODEL`, `GEMINI_GENERATION_MODEL` | Gemini model configuration | See `.env.example` |
| `MAX_CONTEXT_CHARS` | Maximum assembled retrieval context for generation | `24000` |
| `DEMO_ENABLED` | Enables the public anonymous demo | `false` |
| `DEMO_RATE_LIMIT_SECRET` | HMAC secret required when demo mode is enabled (32+ bytes) | Required only with demo enabled |
| `DEMO_*` | Demo TTL, concurrency, resource limits, rate limits, and cleanup interval | Defaults and bounds in `.env.example` |

Never commit `backend/.env` or any other credentials. The root `.gitignore`
ignores `.env` files, passwords, API keys, certificates, private keys,
credential files, local databases, dependencies, logs, caches, and build
output. Share configuration changes by updating `.env.example`, not `.env`.

## Render deployment

The backend provides cookie-based authentication and scopes regular repository
APIs to the signed-in owner. Anonymous recruiter demos are a separate,
opt-in API and do not weaken authenticated repository ownership.

The live application is available at the [Repo-AI live demo](https://repo-ai-frontend.onrender.com).
For a separate deployment, create a Render PostgreSQL database, backend Web
Service, and frontend Static Site. Both package manifests require Node 22. For the backend, use build command
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
| `AUTH_JWT_SECRET` | Random signing secret of at least 32 bytes |
| `AUTH_COOKIE_SAME_SITE` | `none` for Render-hosted frontend/backend origins |
| `REPOSITORY_STORAGE_PATH` | An absolute directory available to the backend instance |

Set `GEMINI_API_KEY` only if enabling real embedding or generation requests.
The public demo remains disabled unless `DEMO_ENABLED=true`; enabling it also
requires a random `DEMO_RATE_LIMIT_SECRET` of at least 32 bytes.

Clone directories are stored under `REPOSITORY_STORAGE_PATH`. If that path is
on ephemeral storage, clones can disappear after a restart, redeployment, or
instance replacement while PostgreSQL metadata remains. Attach a persistent
disk and point `REPOSITORY_STORAGE_PATH` at it if clone-dependent operations
must survive restarts. Use one backend instance unless clone storage is
genuinely shared; PostgreSQL advisory locks do not share local files. Use a
Render internal database URL for same-region traffic; external PostgreSQL
URLs require TLS.

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

Initialize or upgrade PostgreSQL before serving application traffic. Run
`npm run db:migrate` from `backend` as a Render pre-deploy command or through a
carefully targeted operator connection. The migration runner skips applied
migrations, applies pending migrations in order and transactionally, and
enables the `vector` extension first. The database user must have permission
to create the extension. The current migration set is 001 through 006.

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

### Search and embeddings

The authenticated workspace offers Structural and Hybrid search. Structural
search matches query terms to indexed symbol names, then retrieves related
graph and source-chunk evidence; it does not infer semantic intent. Hybrid
search adds semantic evidence when Gemini is available and chunks have stored
vectors, with structural fallback metadata when semantic retrieval is
unavailable. The unified query API also accepts `mode: "semantic"`; if query
embedding fails, it returns structural fallback evidence marked unavailable.
A standalone semantic option is not currently shown in the workspace.

Generate missing embeddings for a repository:

```http
POST /api/repositories/{repositoryId}/embeddings
```

The legacy semantic search endpoint embeds the query and searches embedded
chunks:

```http
POST /api/repositories/{repositoryId}/search
Content-Type: application/json

{"query":"payment validation flow","limit":5}
```

Its limit defaults to 5 and is capped at 50. Embeddings are generated in
batches, and failed chunks remain retryable. Semantic coverage can be partial
until all eligible chunks have embeddings.

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

Trace and impact depth values are limited to 1–5. Path requests are directed
walks following each relationship's stored source-to-target direction. They
default to `CALLS`; callers can pass a non-empty `relationshipTypes` array
containing any combination of `CALLS`, `IMPORTS`, `IMPLEMENTS`, and `EXTENDS`.
The path API returns up to five distinct shortest paths only. `steps` remains
the first deterministic shortest path for compatibility; `paths` contains all
returned alternatives. `traversalTruncated` reports the shared 10,000-edge
search budget, `alternativePathsTruncated` reports additional shortest paths
omitted beyond five, and `pathsTruncated` is true when either condition occurs.
These are static graph paths, not proof of runtime execution.

The impact endpoints return graph-derived caller, implementation, or subclass
evidence as available. Import evidence identifies a dependent file; it does
not prove symbol-level use of an imported symbol. The authenticated `/impact`
frontend route is still a placeholder; impact analysis is currently available to API clients.
Caller and callee exploration is available in each selected method or
function's Symbols detail panel. The sidebar no longer has a separate Callers
item; `/callers` remains a compatibility route to Symbols.

### Unified repository query API

```http
POST /api/repositories/{repositoryId}/query/symbol
{"symbolId":"<symbol-uuid>"}

GET /api/repositories/{repositoryId}/query/symbols?page=1&pageSize=50&search=payment

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

Search modes are `semantic`, `structural`, and `hybrid`. Structural search and
graph queries work without Gemini. Hybrid graph expansion is capped at depth
2.
Unified path requests accept the same optional `relationshipTypes` filter and
use `CALLS` when it is omitted.

## Database notes

PostgreSQL stores repository records, files, symbols, relationships, code
chunks, and optional vector embeddings. Ensure the configured database exists
and that required migrations/schema setup has been applied before exercising
ingestion or query endpoints. Semantic search requires vectors generated after
indexing; structural and graph queries do not.
