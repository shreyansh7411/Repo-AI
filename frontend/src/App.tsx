import { useCallback, useEffect, useMemo, useState } from 'react'
import { repositoryApi, type RepositoryIndexResult, type RepositorySearchResult, type RepositorySummary, type SearchMode } from './api/client'
import { AddRepositoryDialog } from './components/AddRepositoryDialog'
import { RepositorySidebar } from './components/RepositorySidebar'
import { SearchWorkspace } from './components/SearchWorkspace'
import { SymbolsWorkspace } from './components/SymbolsWorkspace'
import { Icon } from './components/Icons'
import { useAuth } from './auth/useAuth'
import './App.css'

const SELECTED_REPOSITORY_KEY = 'repo-ai:selected-repository'

function App() {
  const { user, logout } = useAuth()
  const [repositories, setRepositories] = useState<RepositorySummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(SELECTED_REPOSITORY_KEY))
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<RepositorySearchResult | null>(null)
  const [activeView, setActiveView] = useState<'search' | 'symbols'>('search')

  const activeRepository = useMemo(() => repositories.find(repository => repository.repositoryId === selectedId) ?? null, [repositories, selectedId])

  const loadRepositories = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const response = await repositoryApi.list()
      setRepositories(response.repositories)
      setSelectedId(current => {
        if (current && response.repositories.some(repository => repository.repositoryId === current)) return current
        return response.repositories[0]?.repositoryId ?? null
      })
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Could not load repositories.')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    repositoryApi.list().then(response => {
      if (!active) return
      setRepositories(response.repositories)
      setSelectedId(current => current && response.repositories.some(repository => repository.repositoryId === current)
        ? current
        : response.repositories[0]?.repositoryId ?? null)
    }).catch(error => {
      if (active) setListError(error instanceof Error ? error.message : 'Could not load repositories.')
    }).finally(() => {
      if (active) setListLoading(false)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (selectedId) localStorage.setItem(SELECTED_REPOSITORY_KEY, selectedId)
    else localStorage.removeItem(SELECTED_REPOSITORY_KEY)
  }, [selectedId])

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setDialogOpen(true)
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  async function addRepository(name: string, url: string) {
    setIndexing(true)
    setIndexError(null)
    setNotice(null)
    try {
      const result: RepositoryIndexResult = await repositoryApi.index(name, url)
      setSearchResult(null)
      setSearchError(null)
      setSelectedId(result.repositoryId)
      setDialogOpen(false)
      setNotice(`Indexed ${name}: ${result.fileCount.toLocaleString()} files and ${result.symbolCount.toLocaleString()} symbols are ready to search.`)
      await loadRepositories()
      setSelectedId(result.repositoryId)
    } catch (error) {
      setIndexError(error instanceof Error ? error.message : 'Repository indexing failed.')
    } finally {
      setIndexing(false)
    }
  }

  async function searchRepository(query: string, mode: SearchMode) {
    if (!activeRepository) return
    setSearching(true)
    setSearchError(null)
    setSearchResult(null)
    try {
      const result = await repositoryApi.search(activeRepository.repositoryId, query, mode)
      setSearchResult(result)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  const connectionState = listLoading ? 'checking' : listError ? 'error' : 'connected'

  return <div className="app-shell">
    <RepositorySidebar
      repositories={repositories}
      selectedId={selectedId}
      loading={listLoading}
      error={listError}
      connectionState={connectionState}
      activeView={activeView}
      onViewChange={setActiveView}
      onSelect={id => { setSelectedId(id); setSearchResult(null); setSearchError(null); setNotice(null) }}
      onRefresh={() => void loadRepositories()}
      onAdd={() => { setIndexError(null); setDialogOpen(true) }}
      user={user!}
      onLogout={() => { void logout().catch(() => undefined) }}
    />
    <div className="main-shell">
      {notice && <div className="success-toast" role="status"><span className="success-check">✓</span>{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><Icon name="close" size={15} /></button></div>}
      {activeRepository && activeView === 'search' ? <SearchWorkspace
        key={activeRepository.repositoryId}
        repositoryName={activeRepository.name}
        repositoryUrl={activeRepository.url}
        fileCount={activeRepository.fileCount}
        symbolCount={activeRepository.symbolCount}
        searchResult={searchResult}
        searching={searching}
        error={searchError}
        onSearch={(query, mode) => void searchRepository(query, mode)}
      /> : activeRepository ? <SymbolsWorkspace
        key={`symbols-${activeRepository.repositoryId}`}
        repositoryId={activeRepository.repositoryId}
        repositoryName={activeRepository.name}
      /> : <main className="main-content welcome-state">
        <header className="workspace-header"><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>Overview</strong></div><div className={`backend-status ${connectionState}`}><span className="status-dot" />{connectionState === 'connected' ? 'Backend connected' : connectionState === 'checking' ? 'Connecting…' : 'Backend unavailable'}</div></header>
        <section className="welcome-card"><div className="welcome-icon"><Icon name="brand" size={28} /></div><p className="eyebrow">REPOSITORY UNDERSTANDING AI</p><h1>Make your codebase<br /><span>make sense.</span></h1><p className="welcome-copy">Index a Git repository to explore its source code with grounded, traceable evidence.</p>
          {listLoading ? <div className="loading-card"><Icon name="spinner" />Loading your workspace…</div> : listError ? <div className="inline-error" role="alert">{listError}<button type="button" className="text-action" onClick={() => void loadRepositories()}>Retry</button></div> : <button className="button-primary" type="button" onClick={() => { setIndexError(null); setDialogOpen(true) }}><Icon name="plus" />Add your first repository <Icon name="arrow" size={16} /></button>}
        </section>
      </main>}
    </div>
    {dialogOpen && <AddRepositoryDialog busy={indexing} error={indexError} onClose={() => { if (!indexing) setDialogOpen(false) }} onSubmit={(name, url) => void addRepository(name, url)} />}
  </div>
}

export default App
