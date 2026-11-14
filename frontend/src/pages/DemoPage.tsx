import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, demoApi, type DemoFilesResponse, type DemoWorkspaceResponse, type RepositorySearchResult, type SearchMode } from '../api/client'
import { SearchWorkspace } from '../components/SearchWorkspace'
import { SymbolsWorkspace } from '../components/SymbolsWorkspace'
import { Icon } from '../components/Icons'
import './DemoPage.css'

type View = 'search' | 'symbols' | 'files'

export function DemoPage() {
  const [workspace, setWorkspace] = useState<DemoWorkspaceResponse | null>(null)
  const [checking, setChecking] = useState(true)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('search')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<RepositorySearchResult | null>(null)

  useEffect(() => {
    let active = true
    demoApi.session().then(result => {
      if (active) { setWorkspace(result); setMessage(null) }
    }).catch(reason => {
      if (!active) return
      if (reason instanceof ApiError && reason.status === 410) setMessage(reason.message)
      else if (!(reason instanceof ApiError && reason.status === 401)) setError(reason instanceof Error ? reason.message : 'Could not restore the demo session.')
    }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    function onExpired(event: Event) {
      const detail = (event as CustomEvent<string>).detail
      setWorkspace(null)
      setSearchResult(null)
      setMessage(detail || 'This demo session has expired. Start a new demo to continue.')
      setError(null)
    }
    window.addEventListener('repo-ai:demo-expired', onExpired)
    return () => window.removeEventListener('repo-ai:demo-expired', onExpired)
  }, [])

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!url.trim()) { setError('Enter a public GitHub repository URL.'); return }
    let parsed: URL
    try { parsed = new URL(url.trim()) } catch { setError('Enter a valid GitHub repository URL.'); return }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.pathname.split('/').filter(Boolean).length !== 2) {
      setError('Use a public GitHub URL such as https://github.com/owner/repository.'); return
    }
    setBusy(true)
    try {
      const result = await demoApi.start(url.trim())
      setWorkspace(result)
      setSearchResult(null)
      setView('search')
      setMessage(`Indexed ${result.repository.name}: ${result.indexing.fileCount.toLocaleString()} files and ${result.indexing.symbolCount.toLocaleString()} symbols are ready.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The public repository could not be indexed.')
    } finally { setBusy(false) }
  }

  async function endDemo() {
    setBusy(true)
    setError(null)
    try {
      await demoApi.end()
      setWorkspace(null)
      setSearchResult(null)
      setUrl('')
      setMessage('Demo ended. Temporary repository data is scheduled for cleanup.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not end the demo session.')
    } finally { setBusy(false) }
  }

  async function searchRepository(query: string, mode: SearchMode) {
    if (!workspace) return
    setSearching(true); setSearchError(null); setSearchResult(null)
    try { setSearchResult(await demoApi.search(workspace.repository.repositoryId, query, mode)) }
    catch (reason) { setSearchError(reason instanceof Error ? reason.message : 'Demo search failed.') }
    finally { setSearching(false) }
  }

  if (checking) return <main className="demo-page"><div className="demo-state"><Icon name="spinner" />Restoring demo session…</div></main>

  if (workspace) return <DemoWorkspace
    workspace={workspace}
    view={view}
    setView={setView}
    endDemo={() => void endDemo()}
    busy={busy}
    message={message}
    error={error}
    onSearch={searchRepository}
    searching={searching}
    searchError={searchError}
    searchResult={searchResult}
  />

  return <main className="demo-page">
    <header className="demo-header"><Link className="marketing-brand" to="/"><span className="marketing-brand-mark"><Icon name="brand" size={21} /></span><span>repo<span className="brand-dot">·</span>ai</span></Link><nav><Link to="/docs">Documentation</Link><Link to="/login">Sign in</Link></nav></header>
    <section className="demo-start-card">
      <span className="demo-badge"><Icon name="spark" size={14} />TEMPORARY PUBLIC REPOSITORY DEMO</span>
      <h1>Explore a repository<br /><span>without an account.</span></h1>
      <p>Enter a public GitHub repository. Repo-AI will clone and index it for a temporary, isolated session. Demo data expires automatically.</p>
      {message && <div className="demo-notice" role="status">{message}</div>}
      {error && <div className="demo-error" role="alert">{error}</div>}
      <form onSubmit={event => void start(event)} className="demo-form">
        <label htmlFor="demo-repo-url">Public GitHub repository URL</label>
        <div className="demo-url-field"><Icon name="code" size={18} /><input id="demo-repo-url" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" disabled={busy} required /></div>
        <button className="marketing-button primary" type="submit" disabled={busy}>{busy ? <><Icon name="spinner" size={16} />Cloning and indexing…</> : <>Start demo<Icon name="arrow" size={16} /></>}</button>
      </form>
      <div className="demo-limits"><span><Icon name="check" size={14} />Public GitHub repositories only</span><span><Icon name="check" size={14} />Temporary, session-isolated data</span><span><Icon name="check" size={14} />No account or repository ownership</span></div>
    </section>
    <footer className="demo-footer"><Link to="/">Repo-AI</Link><span>Temporary demo sessions are automatically removed after expiration.</span></footer>
  </main>
}

function DemoWorkspace({ workspace, view, setView, endDemo, busy, message, error, onSearch, searching, searchError, searchResult }: {
  workspace: DemoWorkspaceResponse
  view: View
  setView: (view: View) => void
  endDemo: () => void
  busy: boolean
  message: string | null
  error: string | null
  onSearch: (query: string, mode: SearchMode) => void
  searching: boolean
  searchError: string | null
  searchResult: RepositorySearchResult | null
}) {
  const repository = workspace.repository
  const [files, setFiles] = useState<DemoFilesResponse | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [filePage, setFilePage] = useState(1)
  const [filesLoading, setFilesLoading] = useState(false)

  useEffect(() => {
    if (view !== 'files') return
    const controller = new AbortController()
    demoApi.files(repository.repositoryId, filePage, 100, controller.signal).then(result => setFiles(result)).catch(reason => {
      if (!controller.signal.aborted) setFilesError(reason instanceof Error ? reason.message : 'Could not load repository files.')
    }).finally(() => { if (!controller.signal.aborted) setFilesLoading(false) })
    return () => controller.abort()
  }, [view, repository.repositoryId, filePage])

  function selectView(nextView: View) {
    if (nextView === 'files' && view !== 'files') {
      setFilesLoading(true)
      setFilesError(null)
    }
    setView(nextView)
  }

  function changeFilePage(update: (page: number) => number) {
    setFilesLoading(true)
    setFilesError(null)
    setFilePage(update)
  }

  const expiry = new Date(workspace.session.expiresAt).toLocaleString()
  return <div className="demo-workspace">
    <header className="demo-workspace-header"><Link className="marketing-brand" to="/"><span className="marketing-brand-mark"><Icon name="brand" size={19} /></span><span>repo<span className="brand-dot">·</span>ai</span></Link><div className="demo-workspace-repo"><strong>{repository.name}</strong><span>Anonymous demo · expires {expiry}</span></div><button className="button-secondary" type="button" disabled={busy} onClick={endDemo}>End Demo</button></header>
    <nav className="demo-tabs" aria-label="Demo repository views">{(['search', 'symbols', 'files'] as const).map(item => <button type="button" key={item} className={view === item ? 'active' : ''} onClick={() => selectView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
    {message && <div className="demo-workspace-notice" role="status">{message}</div>}
    {error && <div className="demo-error demo-workspace-notice-error" role="alert">{error}</div>}
    {view === 'search' && <><div className="demo-search-note">Structural search is available. Semantic and hybrid search are disabled because demo repositories do not generate embeddings.</div><SearchWorkspace repositoryName={repository.name} repositoryUrl={repository.url} fileCount={repository.fileCount} symbolCount={repository.symbolCount} searchResult={searchResult} searching={searching} error={searchError} onSearch={onSearch} availableModes={['structural']} showHeaderActions={false} /></>}
    {view === 'symbols' && <SymbolsWorkspace key={repository.repositoryId} repositoryId={repository.repositoryId} repositoryName={repository.name} api={demoApi} showHeaderActions={false} />}
    {view === 'files' && <main className="main-content demo-files"><header className="workspace-header"><div className="breadcrumb"><span>Demo</span><span className="breadcrumb-slash">/</span><strong>Files</strong></div></header><h1>Repository files</h1><p>Files discovered during indexing, scoped to this demo session.</p>
      {filesLoading && <div className="demo-state"><Icon name="spinner" />Loading files…</div>}{filesError && <div className="demo-error" role="alert">{filesError}</div>}{!filesLoading && !filesError && files?.totalCount === 0 && <div className="demo-state">No source files were indexed.</div>}
      {!filesLoading && files && files.files.length > 0 && <><div className="demo-file-list">{files.files.map(file => <article key={file.id}><Icon name="code" size={15} /><strong title={file.path}>{file.path}</strong><span>{file.language || 'Source'}</span><small>{file.size === null ? '' : `${file.size.toLocaleString()} bytes`}{file.startLine !== null ? ` · lines ${file.startLine}–${file.endLine}` : ''}</small></article>)}</div><div className="demo-file-pagination"><button className="button-secondary" type="button" disabled={filePage <= 1} onClick={() => changeFilePage(value => value - 1)}>Previous</button><span>Page {filePage} of {Math.max(1, Math.ceil(files.totalCount / files.pageSize))}</span><button className="button-secondary" type="button" disabled={filePage * files.pageSize >= files.totalCount} onClick={() => changeFilePage(value => value + 1)}>Next</button></div></>}
    </main>}
  </div>
}
