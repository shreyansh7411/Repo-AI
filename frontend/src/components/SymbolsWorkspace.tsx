import { useEffect, useMemo, useState } from 'react'
import { repositoryApi, type CallTraceResult, type RepositoryExplorerClient, type RepositorySymbolDetails, type RepositorySymbolPage, type RepositorySymbolSummary, type SymbolType } from '../api/client'
import { Icon } from './Icons'
import { WorkspaceHeaderActions } from './WorkspaceHeaderActions'

const PAGE_SIZE = 50
const SYMBOL_TYPES: Array<{ value: SymbolType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'CLASS', label: 'Class' },
  { value: 'INTERFACE', label: 'Interface' },
  { value: 'METHOD', label: 'Method' },
  { value: 'FUNCTION', label: 'Function' },
  { value: 'CONSTRUCTOR', label: 'Constructor' },
  { value: 'ENUM', label: 'Enum' },
  { value: 'FIELD', label: 'Field' },
  { value: 'VARIABLE', label: 'Variable' },
]

interface Props { repositoryId: string; repositoryName: string; api?: RepositoryExplorerClient; showHeaderActions?: boolean }
type CallTraceState = { status: 'error'; message: string } | { status: 'loaded'; result: CallTraceResult }
interface SymbolHistoryEntry { id: string; name: string }

export function SymbolsWorkspace({ repositoryId, repositoryName, api = repositoryApi, showHeaderActions = false }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [type, setType] = useState<SymbolType | ''>('')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [pageResult, setPageResult] = useState<RepositorySymbolPage | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<RepositorySymbolDetails | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [callers, setCallers] = useState<CallTraceState | null>(null)
  const [callees, setCallees] = useState<CallTraceState | null>(null)
  const [traceRetry, setTraceRetry] = useState(0)
  const [symbolHistory, setSymbolHistory] = useState<SymbolHistoryEntry[]>([])

  const visibleKey = `${repositoryId}:${page}:${type}:${search.trim()}`
  const groups = useMemo(() => {
    const byPath = new Map<string, RepositorySymbolSummary[]>()
    for (const symbol of pageResult?.symbols ?? []) {
      const rows = byPath.get(symbol.file.path) ?? []
      rows.push(symbol)
      byPath.set(symbol.file.path, rows)
    }
    return [...byPath].map(([path, symbols]) => ({ path, symbols }))
  }, [pageResult])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), search.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    const requestKey = `${repositoryId}:${page}:${type}:${debouncedSearch}`
    api.listSymbols(repositoryId, { page, pageSize: PAGE_SIZE, type, search: debouncedSearch }, controller.signal)
      .then(result => {
        setPageResult(result)
        setListError(null)
        setLoadedKey(requestKey)
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setListError(error instanceof Error ? error.message : 'Could not load symbols.')
        setLoadedKey(requestKey)
      })
    return () => controller.abort()
  }, [api, repositoryId, page, type, debouncedSearch, retry])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    api.getSymbol(repositoryId, selectedId, controller.signal)
      .then(result => { setDetails(result); setDetailsError(null) })
      .catch(error => {
        if (controller.signal.aborted) return
        setDetailsError(error instanceof Error ? error.message : 'Could not load symbol details.')
      })
    return () => controller.abort()
  }, [api, repositoryId, selectedId])

  useEffect(() => {
    if (!selectedId || !details || details.id !== selectedId) return
    if (details.type !== 'METHOD' && details.type !== 'FUNCTION') return

    const controller = new AbortController()
    api.getCallers(repositoryId, selectedId, controller.signal)
      .then(result => setCallers({ status: 'loaded', result }))
      .catch(error => {
        if (!controller.signal.aborted) setCallers({ status: 'error', message: error instanceof Error ? error.message : 'Could not load callers.' })
      })
    api.getCallees(repositoryId, selectedId, controller.signal)
      .then(result => setCallees({ status: 'loaded', result }))
      .catch(error => {
        if (!controller.signal.aborted) setCallees({ status: 'error', message: error instanceof Error ? error.message : 'Could not load callees.' })
      })
    return () => controller.abort()
  }, [api, repositoryId, selectedId, details, traceRetry])

  const loading = loadedKey !== visibleKey
  const selectedSymbol = pageResult?.symbols.find(symbol => symbol.id === selectedId) ?? null
  const detailIsCurrent = details?.id === selectedId

  function changeSearch(value: string) {
    setSearch(value)
    setPage(1)
    setSelectedId(null)
    setDetails(null)
    setDetailsError(null)
    setCallers(null)
    setCallees(null)
    setSymbolHistory([])
  }

  function changeType(value: SymbolType | '') {
    setType(value)
    setPage(1)
    setSelectedId(null)
    setDetails(null)
    setDetailsError(null)
    setCallers(null)
    setCallees(null)
    setSymbolHistory([])
  }

  function selectSymbol(symbol: RepositorySymbolSummary) {
    setSelectedId(symbol.id)
    setDetails(null)
    setDetailsError(null)
    setCallers(null)
    setCallees(null)
    setSymbolHistory([])
  }

  function navigateToRelated(symbol: CallTraceResult['results'][number]['symbol']) {
    if (!selectedId) return
    const currentName = details?.id === selectedId ? details.name : selectedSymbol?.name ?? 'symbol'
    setSymbolHistory(history => [...history, { id: selectedId, name: currentName }])
    setSelectedId(symbol.id)
    setDetails(null)
    setDetailsError(null)
    setCallers(null)
    setCallees(null)
  }

  function returnToPreviousSymbol() {
    const previous = symbolHistory.at(-1)
    if (!previous) return
    setSymbolHistory(history => history.slice(0, -1))
    setSelectedId(previous.id)
    setDetails(null)
    setDetailsError(null)
    setCallers(null)
    setCallees(null)
  }

  return <main className="main-content symbols-workspace">
    <header className="workspace-header"><div className="breadcrumb"><span>Repositories</span><span className="breadcrumb-slash">/</span><span>{repositoryName}</span><span className="breadcrumb-slash">/</span><strong>Symbols</strong></div><div className="workspace-header-right"><span className="symbols-header-label"><Icon name="code" size={15} />SYMBOL EXPLORER</span>{showHeaderActions && <WorkspaceHeaderActions />}</div></header>

    <section className="symbols-heading"><div><p className="eyebrow">CODE STRUCTURE</p><h1>Symbols</h1><p>Browse declarations extracted from this repository.</p></div><div className="symbol-total"><span className="stat-value">{loading ? '—' : (pageResult?.totalCount ?? 0).toLocaleString()}</span><span className="stat-label">matching symbols</span></div></section>

    <section className="symbol-browser" aria-label="Browse repository symbols">
      <div className="symbol-browser-toolbar">
        <label className="symbol-search"><Icon name="search" size={17} /><input value={search} onChange={event => changeSearch(event.target.value)} placeholder="Search symbol names…" aria-label="Search symbol names" /><kbd>⌕</kbd></label>
        <label className="symbol-type-filter"><span>TYPE</span><select aria-label="Filter symbols by type" value={type} onChange={event => changeType(event.target.value as SymbolType | '')}>{SYMBOL_TYPES.map(option => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}</select></label>
        {(type || search) && <button type="button" className="clear-filters" onClick={() => { changeSearch(''); changeType('') }}>Clear filters</button>}
      </div>

      <div className="symbol-browser-layout">
        <section className="symbol-results-pane" aria-label="Symbol results">
          <div className="symbol-results-caption"><span>{loading ? 'Loading symbols…' : `${(pageResult?.totalCount ?? 0).toLocaleString()} results`}</span><span>Sorted by file and line</span></div>
          {listError && loadedKey === visibleKey && <div className="symbol-state error-text" role="alert"><strong>Couldn’t load symbols</strong><span>{listError}</span><button className="text-action" type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
          {loading && <div className="symbol-state"><Icon name="spinner" />Loading repository symbols…</div>}
          {!loading && !listError && pageResult?.totalCount === 0 && <div className="symbol-state symbol-empty"><Icon name="code" size={22} /><strong>{search || type ? 'No matching symbols' : 'No symbols extracted'}</strong><span>{search || type ? 'Try clearing the search or type filter.' : 'This repository has no indexed symbol declarations.'}</span></div>}
          {!loading && !listError && pageResult && pageResult.totalCount > 0 && <div className="symbol-groups">{groups.map(group => <div className="symbol-file-group" key={group.path}>
            <div className="symbol-file-heading"><Icon name="folder" size={14} /><span title={group.path}>{group.path}</span><span className="file-symbol-count">{group.symbols.length}</span></div>
            {group.symbols.map(symbol => <button type="button" className={`symbol-row${selectedId === symbol.id ? ' selected' : ''}`} key={symbol.id} onClick={() => selectSymbol(symbol)} aria-pressed={selectedId === symbol.id}>
              <span className={`symbol-type-mark type-${symbol.type.toLowerCase()}`}><TypeGlyph type={symbol.type} /></span>
              <span className="symbol-row-main"><strong>{symbol.name}</strong><span>{symbol.parent ? `${symbol.parent.name} · ` : ''}{symbol.signature || symbol.type.toLowerCase()}</span></span>
              <span className="symbol-row-line">L{symbol.startLine}{symbol.endLine !== symbol.startLine ? `–${symbol.endLine}` : ''}</span>
            </button>)}
          </div>)}</div>}
          {!loading && !listError && (pageResult?.totalPages ?? 0) > 1 && <div className="symbol-pagination"><button type="button" className="button-secondary" onClick={() => { setSelectedId(null); setDetails(null); setPage(value => Math.max(1, value - 1)) }} disabled={page <= 1}>Previous</button><span>Page {page} of {pageResult?.totalPages}</span><button type="button" className="button-secondary" onClick={() => { setSelectedId(null); setDetails(null); setPage(value => Math.min(pageResult?.totalPages ?? value, value + 1)) }} disabled={page >= (pageResult?.totalPages ?? 1)}>Next</button></div>}
        </section>

        <aside className="symbol-detail-pane" aria-label="Selected symbol details">
          {!selectedId && <div className="detail-placeholder"><div className="detail-placeholder-icon"><Icon name="code" size={22} /></div><strong>Select a symbol</strong><span>Choose a declaration to inspect its location, signature, parent, and source context.</span></div>}
          {selectedId && !detailIsCurrent && !detailsError && <div className="detail-placeholder"><Icon name="spinner" /><span>Loading symbol details…</span></div>}
          {selectedId && detailsError && <div className="symbol-state error-text" role="alert"><strong>Couldn’t load symbol details</strong><span>{detailsError}</span><button type="button" className="text-action" onClick={() => { const selected = selectedSymbol; if (selected) selectSymbol(selected) }}>Retry</button></div>}
          {selectedId && detailIsCurrent && details && <>
            {symbolHistory.length > 0 && <button type="button" className="symbol-history-back" onClick={returnToPreviousSymbol}>← Back to {symbolHistory[symbolHistory.length - 1].name}</button>}
            <SymbolDetails symbol={details} callers={callers} callees={callees} onNavigate={navigateToRelated} onRetryTraces={() => setTraceRetry(value => value + 1)} />
          </>}
        </aside>
      </div>
    </section>
    <footer className="workspace-footer"><span>Symbols and locations come from the repository index.</span><span>Line ranges are inclusive</span></footer>
  </main>
}

function SymbolDetails({ symbol, callers, callees, onNavigate, onRetryTraces }: {
  symbol: RepositorySymbolDetails
  callers: CallTraceState | null
  callees: CallTraceState | null
  onNavigate: (symbol: CallTraceResult['results'][number]['symbol']) => void
  onRetryTraces: () => void
}) {
  return <div className="symbol-details">
    <div className="detail-header"><span className={`symbol-type-mark type-${symbol.type.toLowerCase()}`}><TypeGlyph type={symbol.type} /></span><span className="detail-type-label">{symbol.type}</span></div>
    <h2>{symbol.name}</h2>
    <div className="detail-file"><Icon name="folder" size={14} /><span title={symbol.file.path}>{symbol.file.path}</span></div>
    <div className="detail-line-grid"><div><span>START LINE</span><strong>{symbol.startLine}</strong></div><div><span>END LINE</span><strong>{symbol.endLine}</strong></div><div><span>LANGUAGE</span><strong>{symbol.file.language || '—'}</strong></div></div>
    {symbol.parent && <div className="detail-property"><span>CONTAINING SYMBOL</span><strong>{symbol.parent.name}</strong><small>{symbol.parent.type}</small></div>}
    {symbol.signature && <div className="detail-section"><span className="detail-section-label">DECLARATION</span><pre className="signature-block"><code>{symbol.signature}</code></pre></div>}
    <div className="detail-section source-context-section"><div className="detail-section-heading"><span className="detail-section-label">SOURCE CONTEXT</span>{symbol.sourceContext && <span>LINES {symbol.sourceContext.startLine}–{symbol.sourceContext.endLine}</span>}</div>
      {symbol.sourceContext ? <pre className="code-snippet symbol-source"><code>{symbol.sourceContext.content}</code></pre> : <p className="context-unavailable">No stored source chunk is available for this symbol.</p>}
    </div>
    <section className="call-explorer" aria-label="Caller and callee explorer">
      <div className="call-explorer-heading"><div><span className="detail-section-label">CALL RELATIONSHIPS</span><h3>Callers &amp; callees</h3></div><span className="call-depth-label">Direct · depth 1</span></div>
      {symbol.type !== 'METHOD' && symbol.type !== 'FUNCTION' ? <p className="call-explorer-note">CALLS exploration is available for methods and functions. This symbol is {symbol.type.toLowerCase()}.</p> : <div className="call-trace-columns">
        <CallTracePanel title="Callers" description="Call this symbol" state={callers} onNavigate={onNavigate} onRetry={onRetryTraces} />
        <CallTracePanel title="Callees" description="Called by this symbol" state={callees} onNavigate={onNavigate} onRetry={onRetryTraces} />
      </div>}
    </section>
  </div>
}

function CallTracePanel({ title, description, state, onNavigate, onRetry }: {
  title: string
  description: string
  state: CallTraceState | null
  onNavigate: (symbol: CallTraceResult['results'][number]['symbol']) => void
  onRetry: () => void
}) {
  const hits = state?.status === 'loaded' ? state.result.results : []
  return <section className={`call-trace-panel ${title.toLowerCase()}`} aria-label={title}>
    <header><strong>{title}</strong><span>{description}</span></header>
    {!state && <div className="call-trace-state"><Icon name="spinner" />Loading {title.toLowerCase()}…</div>}
    {state?.status === 'error' && <div className="call-trace-state call-trace-error" role="alert"><span>{state.message}</span><button type="button" onClick={onRetry}>Retry</button></div>}
    {state?.status === 'loaded' && hits.length === 0 && <div className="call-trace-state">No {title.toLowerCase()} found.</div>}
    {hits.map(hit => <button type="button" className="call-trace-row" key={`${hit.relationship.id}:${hit.symbol.id}`} onClick={() => onNavigate(hit.symbol)}>
      <span className="call-trace-row-top"><strong>{hit.symbol.name}</strong><span>{hit.symbol.type}</span></span>
      <span className="call-trace-path" title={hit.symbol.filePath}>{hit.symbol.filePath}</span>
      <span className="call-trace-row-bottom"><span>Lines {hit.symbol.startLine}–{hit.symbol.endLine}</span><span>{hit.relationship.type}</span></span>
    </button>)}
  </section>
}

function TypeGlyph({ type }: { type: SymbolType }) {
  const glyph: Record<SymbolType, string> = { CLASS: 'C', INTERFACE: 'I', ENUM: 'E', METHOD: 'M', FUNCTION: 'ƒ', CONSTRUCTOR: '↗', FIELD: 'F', VARIABLE: 'v' }
  return <span aria-hidden="true">{glyph[type]}</span>
}

