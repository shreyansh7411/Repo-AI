import { useEffect, useId, useRef, useState } from 'react'
import { repositoryApi, type RelationshipType, type RepositoryPathResult, type RepositoryPathStep, type RepositorySymbolSummary } from '../api/client'
import { Icon } from './Icons'
import { WorkspaceHeaderActions } from './WorkspaceHeaderActions'

const RELATIONSHIP_OPTIONS: Array<{ type: RelationshipType; label: string }> = [
  { type: 'CALLS', label: 'Calls' },
  { type: 'IMPORTS', label: 'Imports' },
  { type: 'IMPLEMENTS', label: 'Implements' },
  { type: 'EXTENDS', label: 'Extends' },
]

interface Props {
  repositoryId: string
  repositoryName: string
  showHeaderActions?: boolean
}

export function PathWorkspace({ repositoryId, repositoryName, showHeaderActions = false }: Props) {
  const [source, setSource] = useState<RepositorySymbolSummary | null>(null)
  const [target, setTarget] = useState<RepositorySymbolSummary | null>(null)
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipType[]>(['CALLS'])
  const [maxDepth, setMaxDepth] = useState(5)
  const [result, setResult] = useState<RepositoryPathResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pathRequestId = useRef(0)

  function invalidatePathRequest() {
    pathRequestId.current += 1
    setSearching(false)
  }

  function chooseSource(symbol: RepositorySymbolSummary | null) {
    invalidatePathRequest()
    setSource(symbol)
    setResult(null)
    setError(null)
  }

  function chooseTarget(symbol: RepositorySymbolSummary | null) {
    invalidatePathRequest()
    setTarget(symbol)
    setResult(null)
    setError(null)
  }

  function toggleRelationship(type: RelationshipType) {
    invalidatePathRequest()
    setRelationshipTypes(current => {
      if (current.includes(type)) return current.length === 1 ? current : current.filter(item => item !== type)
      return [...current, type].sort()
    })
    setResult(null)
    setError(null)
  }

  async function findPaths() {
    if (!source || !target || searching) return
    const requestId = ++pathRequestId.current
    setSearching(true)
    setError(null)
    setResult(null)
    try {
      const response = await repositoryApi.findPaths(repositoryId, {
        fromSymbolId: source.id,
        toSymbolId: target.id,
        maxDepth,
        relationshipTypes,
      })
      if (pathRequestId.current !== requestId) return
      setResult(response)
    } catch (requestError) {
      if (pathRequestId.current !== requestId) return
      setError(requestError instanceof Error ? requestError.message : 'Could not search repository paths.')
    } finally {
      if (pathRequestId.current === requestId) setSearching(false)
    }
  }

  return <main className="main-content path-workspace">
    <header className="workspace-header">
      <div className="breadcrumb"><span>Repositories</span><span className="breadcrumb-slash">/</span><span>{repositoryName}</span><span className="breadcrumb-slash">/</span><strong>Path Explorer</strong></div>
      {showHeaderActions && <WorkspaceHeaderActions />}
    </header>

    <section className="path-heading">
      <div><p className="eyebrow">STRUCTURAL ANALYSIS</p><h1>Path Explorer</h1><p>Find the shortest directed routes between indexed symbols.</p></div>
      <span className="path-depth-badge"><Icon name="flow" size={16} />Depth up to 5</span>
    </section>

    <section className="path-controls" aria-label="Path search controls">
      <div className="path-symbol-selectors">
        <SymbolPicker repositoryId={repositoryId} label="Source symbol" selected={source} onSelect={chooseSource} disabled={searching} />
        <div className="path-selector-connector" aria-hidden="true">→</div>
        <SymbolPicker repositoryId={repositoryId} label="Target symbol" selected={target} onSelect={chooseTarget} disabled={searching} />
      </div>

      <div className="path-options-row">
        <fieldset className="path-relationship-options" disabled={searching}>
          <legend>Relationship types</legend>
          <div className="path-checkbox-list">{RELATIONSHIP_OPTIONS.map(option => <label key={option.type} className={`path-checkbox${relationshipTypes.includes(option.type) ? ' selected' : ''}`}>
            <input type="checkbox" checked={relationshipTypes.includes(option.type)} disabled={relationshipTypes.length === 1 && relationshipTypes.includes(option.type)} onChange={() => toggleRelationship(option.type)} />
            <span>{option.label}</span>
          </label>)}</div>
          <span className="path-field-hint">Follows each stored relationship from source to target.</span>
        </fieldset>
        <label className="path-depth-select"><span>Maximum depth</span><select value={maxDepth} disabled={searching} onChange={event => { invalidatePathRequest(); setMaxDepth(Number(event.target.value)); setResult(null); setError(null) }}>
          {[1, 2, 3, 4, 5].map(depth => <option key={depth} value={depth}>{depth} {depth === 1 ? 'edge' : 'edges'}</option>)}
        </select></label>
        <button className="button-primary path-submit" type="button" onClick={() => void findPaths()} disabled={!source || !target || searching}>
          {searching ? <><Icon name="spinner" />Finding paths…</> : <><Icon name="flow" />Find paths</>}
        </button>
      </div>
    </section>

    <section className="path-results" aria-live="polite" aria-label="Path search results">
      {!result && !error && !searching && <div className="path-empty-state">
        <span className="path-empty-icon"><Icon name="flow" size={24} /></span><h2>Choose two symbols to begin</h2>
        <p>Search this repository for a source and target. Repo-AI will return up to five shortest paths using the selected relationship types.</p>
      </div>}
      {searching && <div className="path-empty-state"><Icon name="spinner" /><h2>Searching the repository graph</h2><p>Checking directed relationships up to depth {maxDepth}.</p></div>}
      {error && <div className="path-error" role="alert"><strong>Path search failed</strong><span>{error}</span><button type="button" className="text-action" onClick={() => void findPaths()} disabled={!source || !target || searching}>Try again</button></div>}
      {result && <>
        {result.traversalTruncated && <div className="path-warning" role="status"><strong>Search was incomplete.</strong><span>The {result.edgeProcessingLimit.toLocaleString()}-edge processing limit was reached. Additional paths may exist, and a no-path result is not conclusive.</span></div>}
        {result.alternativePathsTruncated && <div className="path-warning alternatives-warning" role="status"><strong>More shortest alternatives exist.</strong><span>Only the first five deterministic shortest paths are shown.</span></div>}
        {result.found ? <>
          <div className="path-results-heading"><div><p className="eyebrow">SHORTEST ROUTES</p><h2>{getDisplayedPaths(result).length} {getDisplayedPaths(result).length === 1 ? 'path' : 'paths'} found</h2></div>
            <span>{result.pathLength} {result.pathLength === 1 ? 'relationship' : 'relationships'} · max depth {result.maxDepth}</span></div>
          <div className="path-list">{getDisplayedPaths(result).map((path, index) => <PathCard key={pathKey(path)} path={path} index={index} />)}</div>
        </> : <div className={`path-empty-state path-no-result${result.traversalTruncated ? ' incomplete' : ''}`}>
          <span className="path-empty-icon"><Icon name={result.traversalTruncated ? 'flow' : 'search'} size={22} /></span>
          <h2>{result.traversalTruncated ? 'No path found within the examined graph' : 'No path found'}</h2>
          <p>{result.traversalTruncated ? 'The edge processing limit prevented a complete search. Try a narrower relationship filter or a smaller depth.' : `No directed path was found within depth ${result.maxDepth} using ${result.relationshipTypes.join(', ')}.`}</p>
        </div>}
        <p className="path-static-note">These results describe static repository graph relationships. They do not prove that a path is reachable during runtime.</p>
      </>}
    </section>
  </main>
}

function SymbolPicker({ repositoryId, label, selected, onSelect, disabled }: {
  repositoryId: string
  label: string
  selected: RepositorySymbolSummary | null
  onSelect: (symbol: RepositorySymbolSummary | null) => void
  disabled: boolean
}) {
  const inputId = useId()
  const listId = useId()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [symbols, setSymbols] = useState<RepositorySymbolSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loadedKey, setLoadedKey] = useState('')
  const [requestError, setRequestError] = useState<{ key: string; message: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const requestKey = `${repositoryId}:${debouncedSearch}:${page}:${retry}`
  const loading = open && (search.trim() !== debouncedSearch || loadedKey !== requestKey)
  const error = requestError?.key === requestKey ? requestError.message : null

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), search.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!open || loadedKey === requestKey) return
    const controller = new AbortController()
    repositoryApi.listSymbols(repositoryId, { page, pageSize: 20, type: '', search: debouncedSearch }, controller.signal)
      .then(response => { setSymbols(response.symbols); setTotalPages(response.totalPages); setLoadedKey(requestKey) })
      .catch(requestError => {
        if (!controller.signal.aborted) {
          setRequestError({ key: requestKey, message: requestError instanceof Error ? requestError.message : 'Could not search symbols.' })
          setLoadedKey(requestKey)
        }
      })
    return () => controller.abort()
  }, [repositoryId, debouncedSearch, page, open, retry, requestKey, loadedKey])

  return <div className="path-symbol-picker">
    <label htmlFor={inputId}>{label}</label>
    <input id={inputId} type="search" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
      value={search} disabled={disabled} placeholder="Search symbol name…" onFocus={() => setOpen(true)}
      onChange={event => { setSearch(event.target.value); setPage(1); setOpen(true) }} onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }} />
    {selected && <div className="path-selected-symbol">
      <span><strong>{selected.name}</strong><small>{selected.type} · {selected.file.path}:L{selected.startLine}</small></span>
      <button type="button" aria-label={`Clear ${label.toLowerCase()}`} disabled={disabled} onClick={() => onSelect(null)}>Clear</button>
    </div>}
    {open && <div id={listId} className="path-symbol-options" role="listbox" aria-label={`${label} search results`}>
      {loading && <div className="path-picker-state"><Icon name="spinner" />Searching symbols…</div>}
      {!loading && error && <div className="path-picker-state path-picker-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {!loading && !error && loadedKey === requestKey && symbols.length === 0 && <div className="path-picker-state">No matching symbols. Try another name.</div>}
      {!loading && !error && loadedKey === requestKey && symbols.map(symbol => <button type="button" role="option" aria-selected={selected?.id === symbol.id} key={symbol.id} className="path-symbol-option" disabled={disabled}
        onMouseDown={event => event.preventDefault()} onClick={() => { onSelect(symbol); setSearch(''); setOpen(false) }}>
        <span className="path-option-title"><strong>{symbol.name}</strong><small>{symbol.type}{symbol.signature ? ` · ${symbol.signature}` : ''}</small></span>
        <span className="path-option-file" title={symbol.file.path}>{symbol.file.path}</span>
        <span className="path-option-line">L{symbol.startLine}–{symbol.endLine}</span>
      </button>)}
      {!loading && !error && loadedKey === requestKey && symbols.length > 0 && <div className="path-picker-hint">Showing page {page} of {totalPages}. Refine the name to narrow results.
        {totalPages > 1 && <span className="path-picker-pagination"><button type="button" disabled={disabled || page <= 1} onMouseDown={event => event.preventDefault()} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" disabled={disabled || page >= totalPages} onMouseDown={event => event.preventDefault()} onClick={() => setPage(value => value + 1)}>Next</button></span>}
      </div>}
    </div>}
  </div>
}

function getDisplayedPaths(result: RepositoryPathResult): RepositoryPathStep[][] {
  const paths = result.paths ?? []
  if (paths.length > 0) return paths
  return result.steps.length > 0 ? [result.steps] : []
}

function pathKey(path: RepositoryPathStep[]): string {
  return path.map(step => `${step.symbol.id}:${step.relationshipFromPrevious?.id ?? 'start'}`).join('/')
}

function PathCard({ path, index }: { path: RepositoryPathStep[]; index: number }) {
  const pathLength = Math.max(path.length - 1, 0)
  return <article className="path-card">
    <header className="path-card-header"><div><span className="path-number">{String(index + 1).padStart(2, '0')}</span><strong>{index === 0 ? 'Shortest path' : `Alternative ${index + 1}`}</strong></div>
      <span>{pathLength} {pathLength === 1 ? 'edge' : 'edges'}</span></header>
    <ol className="path-sequence" aria-label={`Path ${index + 1}`}>
      {path.map((step, stepIndex) => <li className="path-sequence-item" key={`${step.symbol.id}:${step.relationshipFromPrevious?.id ?? 'start'}`}>
        <div className="path-symbol-node"><span className="path-node-index">{stepIndex}</span><div className="path-node-copy">
          <strong title={step.symbol.name}>{step.symbol.name}</strong><span className="path-node-meta">{step.symbol.type} · lines {step.symbol.startLine}–{step.symbol.endLine}</span>
          <span className="path-node-file" title={step.file.path}>{step.file.path}</span>
        </div></div>
        {stepIndex < path.length - 1 && <PathEdge from={step} to={path[stepIndex + 1]} />}
      </li>)}
    </ol>
  </article>
}

function PathEdge({ from, to }: { from: RepositoryPathStep; to: RepositoryPathStep }) {
  const relationship = to.relationshipFromPrevious
  if (!relationship) return null
  const adjacent = [from.symbol, to.symbol]
  const source = adjacent.find(symbol => symbol.id === relationship.fromSymbolId)
  const target = adjacent.find(symbol => symbol.id === relationship.toSymbolId)
  return <div className="path-edge" aria-label={`${relationship.type}: ${source?.name ?? relationship.fromSymbolId} to ${target?.name ?? relationship.toSymbolId}`}>
    <span className="path-edge-line" aria-hidden="true" />
    <span className="path-edge-label">{relationship.type}</span>
    <span className="path-edge-direction">{`${source?.name ?? relationship.fromSymbolId} → ${target?.name ?? relationship.toSymbolId}`}</span>
  </div>
}
