import { useEffect, useMemo, useState } from 'react'
import { repositoryApi, type RepositorySymbolDetails, type RepositorySymbolPage, type RepositorySymbolSummary, type SymbolType } from '../api/client'
import { Icon } from './Icons'

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

interface Props { repositoryId: string; repositoryName: string }

export function SymbolsWorkspace({ repositoryId, repositoryName }: Props) {
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
    repositoryApi.listSymbols(repositoryId, { page, pageSize: PAGE_SIZE, type, search: debouncedSearch }, controller.signal)
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
  }, [repositoryId, page, type, debouncedSearch, retry])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    repositoryApi.getSymbol(repositoryId, selectedId, controller.signal)
      .then(result => { setDetails(result); setDetailsError(null) })
      .catch(error => {
        if (controller.signal.aborted) return
        setDetailsError(error instanceof Error ? error.message : 'Could not load symbol details.')
      })
    return () => controller.abort()
  }, [repositoryId, selectedId])

  const loading = loadedKey !== visibleKey
  const selectedSymbol = pageResult?.symbols.find(symbol => symbol.id === selectedId) ?? null
  const detailIsCurrent = details?.id === selectedId

  function changeSearch(value: string) {
    setSearch(value)
    setPage(1)
    setSelectedId(null)
    setDetails(null)
    setDetailsError(null)
  }

  function changeType(value: SymbolType | '') {
    setType(value)
    setPage(1)
    setSelectedId(null)
    setDetails(null)
    setDetailsError(null)
  }

  function selectSymbol(symbol: RepositorySymbolSummary) {
    setSelectedId(symbol.id)
    setDetails(null)
    setDetailsError(null)
  }

  return <main className="main-content symbols-workspace">
    <header className="workspace-header"><div className="breadcrumb"><span>Repositories</span><span className="breadcrumb-slash">/</span><span>{repositoryName}</span><span className="breadcrumb-slash">/</span><strong>Symbols</strong></div><span className="symbols-header-label"><Icon name="code" size={15} />SYMBOL EXPLORER</span></header>

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
          {selectedId && detailIsCurrent && details && <SymbolDetails symbol={details} />}
        </aside>
      </div>
    </section>
    <footer className="workspace-footer"><span>Symbols and locations come from the repository index.</span><span>Line ranges are inclusive</span></footer>
  </main>
}

function SymbolDetails({ symbol }: { symbol: RepositorySymbolDetails }) {
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
  </div>
}

function TypeGlyph({ type }: { type: SymbolType }) {
  const glyph: Record<SymbolType, string> = { CLASS: 'C', INTERFACE: 'I', ENUM: 'E', METHOD: 'M', FUNCTION: 'ƒ', CONSTRUCTOR: '↗', FIELD: 'F', VARIABLE: 'v' }
  return <span aria-hidden="true">{glyph[type]}</span>
}

