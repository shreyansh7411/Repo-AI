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
| `REPOSITORY_STORAGE_PATH` | Absolute directory for cloned repositories | `backend/repositories` default locally |
| `GEMINI_API_KEY` | Gemini access key | Optional |
| `GEMINI_EMBEDDING_MODEL` | Embedding model | `gemini-embedding-2` |
| `GEMINI_GENERATION_MODEL` | Generation model | `gemini-3.8-flash` |
| `MAX_CONTEXT_CHARS` | Maximum generated context size | `24000` |

Never commit `backend/.env` or any other credentials. The root `.gitignore`
ignores `.env` files, passwords, API keys, certificates, private keys,
credential files, local databases, dependencies, logs, caches, and build
output. Share configuration changes by updating `.env.example`, not `.env`.

## Render deployment

The application currently has no authentication. Anyone who can reach the
deployment can use its repository indexing and query APIs. Deploy it only for
the intended personal-use environment and account for that public exposure.

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
| `REPOSITORY_STORAGE_PATH` | `/var/data/repositories` |

Attach a persistent disk to the backend Web Service mounted at `/var/data`,
with enough capacity for cloned repositories. Clones are stored under
`/var/data/repositories/<repository-uuid>`. Render files outside the mounted
disk are ephemeral, and persistent disks require a paid Web Service. PostgreSQL
stores indexed metadata, not Git working trees. Use a Render internal database
URL for same-region traffic; external PostgreSQL URLs require TLS.

Set the frontend build-time variable `VITE_API_BASE_URL` to
`https://<backend-service>.onrender.com/api`. Production CORS allows only the
configured frontend origin; local development retains permissive CORS.

Initialize a fresh PostgreSQL database before serving application traffic. Run
`cd backend && npm run db:migrate` as a Render pre-deploy command or manually
against the production database. The command resolves migration files relative
to the migration module, enables PostgreSQL's `vector` extension first, and
applies pending migrations transactionally. The database user must have
permission to create the extension.

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
