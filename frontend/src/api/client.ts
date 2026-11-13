const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '')

export interface AuthUser {
  id: string
  name: string
  email: string
  createdAt: string
}

export interface AuthResponse {
  user: AuthUser
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface RepositorySummary {
  repositoryId: string
  name: string
  url: string | null
  indexingStatus: 'INDEXED' | 'NOT_INDEXED'
  fileCount: number
  symbolCount: number
  createdAt: string
  indexedAt: string | null
}

export interface RepositoryIndexResult {
  message: string
  repositoryId: string
  fileCount: number
  symbolCount: number
  relationshipCount: number
  chunkCount: number
}

export type SearchMode = 'structural' | 'hybrid'

export interface SearchEvidence {
  kind: 'CODE_CHUNK' | 'RELATIONSHIP'
  source: 'SEMANTIC' | 'STRUCTURAL' | 'BOTH'
  file: { id: string; path: string; language: string | null }
  symbol: { id: string; name: string; type: string } | null
  startLine: number
  endLine: number
  content?: string
  chunkId?: string
  similarity?: number
  relationship?: {
    id: string
    type: string
    sourceSymbol: { id: string; name: string; type: string; fileId: string; filePath: string; startLine: number; endLine: number }
    targetSymbol: { id: string; name: string; type: string; fileId: string; filePath: string; startLine: number; endLine: number }
  }
}

export interface RepositorySearchResult {
  repositoryId: string
  query: string
  mode: 'semantic' | 'structural' | 'hybrid'
  topK: number
  maxDepth: number
  effectiveMaxDepth?: number
  semanticAvailable: boolean | null
  semanticError?: string
  evidence: SearchEvidence[]
}

export type SymbolType = 'CLASS' | 'INTERFACE' | 'ENUM' | 'METHOD' | 'CONSTRUCTOR' | 'FUNCTION' | 'FIELD' | 'VARIABLE'

export interface RepositorySymbolSummary {
  id: string
  name: string
  type: SymbolType
  file: { id: string; path: string; language: string | null }
  startLine: number
  endLine: number
  signature: string | null
  parent: { id: string; name: string; type: string } | null
}

export interface RepositorySymbolPage {
  repositoryId: string
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  symbols: RepositorySymbolSummary[]
}

export interface RepositorySymbolDetails extends RepositorySymbolSummary {
  sourceContext: { startLine: number; endLine: number; content: string } | null
}

export interface GraphSymbolReference {
  id: string
  name: string
  type: string
  fileId: string
  filePath: string
  language: string | null
  startLine: number
  endLine: number
  parentSymbolId: string | null
  parentSymbolName: string | null
  parentSymbolType: string | null
}

export interface CallTraceResult {
  repositoryId: string
  direction: 'INCOMING' | 'OUTGOING'
  target: GraphSymbolReference
  maxDepth: number
  relationshipTypes: string[]
  results: Array<{
    symbol: GraphSymbolReference
    depth: number
    direct: boolean
    relationship: { id: string; type: string; fromSymbolId: string; toSymbolId: string }
  }>
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch {
    throw new Error(`The browser could not complete a network request to ${API_BASE_URL}. Check that the backend is running and that its CORS_ORIGIN allows this frontend origin.`)
  }

  const contentType = response.headers.get('content-type') || ''
  const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('repo-ai:unauthorized'))
    }
    throw new ApiError(extractMessage(payload, response.status), response.status)
  }
  return payload as T
}

function extractMessage(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = payload.error
    if (typeof error === 'string') return error
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  }
  return `Repository API request failed with status ${status}.`
}

export const repositoryApi = {
  list: () => request<{ repositories: RepositorySummary[] }>('/repositories'),
  index: (name: string, url: string) => request<RepositoryIndexResult>('/repositories/index', {
    method: 'POST', body: JSON.stringify({ name, url }),
  }),
  search: (repositoryId: string, query: string, mode: SearchMode) =>
    request<RepositorySearchResult>(`/repositories/${encodeURIComponent(repositoryId)}/query/search`, {
      method: 'POST', body: JSON.stringify({ query, mode, topK: 8, maxDepth: 1 }),
    }),
  listSymbols: (repositoryId: string, options: { page: number; pageSize: number; type: SymbolType | ''; search: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(options.page), pageSize: String(options.pageSize) })
    if (options.type) params.set('type', options.type)
    if (options.search) params.set('search', options.search)
    return request<RepositorySymbolPage>(`/repositories/${encodeURIComponent(repositoryId)}/query/symbols?${params}`, { signal })
  },
  getSymbol: (repositoryId: string, symbolId: string, signal?: AbortSignal) =>
    request<RepositorySymbolDetails>(`/repositories/${encodeURIComponent(repositoryId)}/query/symbol`, {
      method: 'POST', body: JSON.stringify({ symbolId }), signal,
    }),
  getCallers: (repositoryId: string, symbolId: string, signal?: AbortSignal) =>
    request<CallTraceResult>(`/repositories/${encodeURIComponent(repositoryId)}/trace/callers`, {
      method: 'POST', body: JSON.stringify({ symbolId, maxDepth: 1 }), signal,
    }),
  getCallees: (repositoryId: string, symbolId: string, signal?: AbortSignal) =>
    request<CallTraceResult>(`/repositories/${encodeURIComponent(repositoryId)}/trace/callees`, {
      method: 'POST', body: JSON.stringify({ symbolId, maxDepth: 1 }), signal,
    }),
}

export const authApi = {
  register: (name: string, email: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),
  me: () => request<AuthResponse>('/auth/me'),
}

export function repositoryNameFromUrl(value: string): string {
  const scpPath = value.match(/^[^@\s]+@[^:\s]+:(.+)$/)?.[1]
  const rawPath = scpPath ?? new URL(value).pathname
  const lastPart = decodeURIComponent(rawPath.split('/').filter(Boolean).at(-1) || '')
  const withoutGit = lastPart.replace(/\.git$/i, '')
  const safeName = withoutGit.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('The repository URL must end with a repository name.')
  return safeName
}

export function validateGitUrl(value: string): string {
  const url = value.trim()
  if (!url) throw new Error('Enter a Git repository URL.')
  if (/^[^@\s]+@[^:\s]+:.+/.test(url)) return url
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('Enter a valid repository URL, such as https://github.com/org/project.git.') }
  const supportedRemote = ['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol) && Boolean(parsed.hostname)
  const supportedLocalGit = parsed.protocol === 'file:' && Boolean(parsed.pathname)
  if (!supportedRemote && !supportedLocalGit) {
    throw new Error('Use an HTTPS, HTTP, SSH, Git, or local Git repository URL.')
  }
  return url
}
