import { useState, type FormEvent } from 'react'
import type { RepositorySearchResult, SearchEvidence, SearchMode } from '../api/client'
import { Icon } from './Icons'

interface Props {
  repositoryName: string
  repositoryUrl: string | null
  fileCount: number
  symbolCount: number
  searchResult: RepositorySearchResult | null
  searching: boolean
  error: string | null
  onSearch: (query: string, mode: SearchMode) => void
}

export function SearchWorkspace({ repositoryName, repositoryUrl, fileCount, symbolCount, searchResult, searching, error, onSearch }: Props) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('structural')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (query.trim()) onSearch(query.trim(), mode)
  }

  return <main className="main-content">
    <header className="workspace-header">
      <div className="breadcrumb"><span>Repositories</span><span className="breadcrumb-slash">/</span><strong>{repositoryName}</strong></div>
      <div className="header-actions"><span className="indexed-label"><span className="status-dot ready" />Indexed</span></div>
    </header>

    <section className="repo-overview">
      <div className="repo-title-row">
        <div className="repo-large-icon"><Icon name="folder" size={23} /></div>
        <div className="repo-title-copy"><div className="eyebrow">REPOSITORY WORKSPACE</div><h1>{repositoryName}</h1><a className="repo-url" href={repositoryUrl ?? undefined} target="_blank" rel="noreferrer">{repositoryUrl || 'Repository URL unavailable'}</a></div>
      </div>
      <div className="repo-stats">
        <div className="stat-item"><span className="stat-value">{fileCount.toLocaleString()}</span><span className="stat-label">Files indexed</span></div>
        <div className="stat-divider" />
        <div className="stat-item"><span className="stat-value">{symbolCount.toLocaleString()}</span><span className="stat-label">Symbols mapped</span></div>
        <div className="stat-divider" />
        <div className="stat-item"><span className="status-dot ready" /><span className="stat-label">Repository ready</span></div>
      </div>
    </section>

    <section className="search-section" aria-labelledby="search-heading">
      <div className="section-heading-row"><div><p className="eyebrow">CODE INTELLIGENCE</p><h2 id="search-heading">Search this repository</h2></div><span className="search-hint"><Icon name="search" size={15} />Natural language or code</span></div>
      <form className="search-form" onSubmit={submit}>
        <div className="search-input-wrap"><Icon name="search" size={19} /><input aria-label="Search source code" value={query} onChange={event => setQuery(event.target.value)} placeholder="Ask about a flow, symbol, or behavior…" /></div>
        <div className="search-controls">
          <div className="mode-switch" role="group" aria-label="Retrieval mode">
            <button className={mode === 'structural' ? 'active' : ''} type="button" onClick={() => setMode('structural')} aria-pressed={mode === 'structural'}>Structural</button>
            <button className={mode === 'hybrid' ? 'active' : ''} type="button" onClick={() => setMode('hybrid')} aria-pressed={mode === 'hybrid'}>Hybrid</button>
          </div>
          <button className="button-primary search-submit" type="submit" disabled={!query.trim() || searching}>
            {searching ? <><Icon name="spinner" size={16} />Searching…</> : <><Icon name="search" size={16} />Search code</>}
          </button>
        </div>
      </form>
      <div className="mode-caption"><span className="status-dot" />{mode === 'structural' ? 'Uses symbols and repository relationships. Works without semantic embeddings.' : 'Combines semantic retrieval with structural evidence when available.'}</div>
    </section>

    {(error || (searchResult?.mode === 'hybrid' && searchResult.semanticAvailable === false)) && <div className={error ? 'notice notice-error' : 'notice notice-fallback'} role="status">
      <span className="notice-mark">{error ? '!' : 'i'}</span>
      <div><strong>{error ? 'Search could not be completed' : 'Structural fallback used'}</strong><p>{error || searchResult?.semanticError || 'Semantic retrieval is unavailable. These results are structural and are not semantic matches.'}</p></div>
    </div>}

    <section className="results-section" aria-live="polite">
      <div className="results-heading"><div><h2>{searchResult ? 'Search evidence' : 'Repository evidence'}</h2><p>{searchResult ? `Results for “${searchResult.query}”` : 'Search to explore code backed by repository evidence.'}</p></div>{searchResult && <span className="result-count">{searchResult.evidence.length} {searchResult.evidence.length === 1 ? 'item' : 'items'}</span>}</div>
      {searching && <div className="loading-card"><Icon name="spinner" /><span>Searching indexed repository data…</span></div>}
      {!searching && !error && searchResult && searchResult.evidence.length === 0 && <div className="empty-results"><div className="empty-icon"><Icon name="search" size={22} /></div><strong>No evidence found</strong><p>Try a symbol name, a related term, or a different search mode.</p></div>}
      {!searching && !error && searchResult && searchResult.evidence.length > 0 && <div className="evidence-list">{searchResult.evidence.map((evidence, index) => <EvidenceCard key={evidence.chunkId || evidence.relationship?.id || `${evidence.file.id}-${evidence.startLine}-${index}`} evidence={evidence} index={index + 1} />)}</div>}
      {!searching && !searchResult && !error && <div className="search-empty-state"><div className="search-empty-art"><div className="empty-code-icon"><Icon name="code" size={27} /></div><span className="orbit orbit-one" /><span className="orbit orbit-two" /></div><strong>Your repository, understood.</strong><p>Search for a code path, a business rule, or a symbol to see grounded source evidence.</p></div>}
    </section>
    <footer className="workspace-footer"><span>Evidence is retrieved from indexed source code.</span><span>Line ranges are inclusive</span></footer>
  </main>
}

function EvidenceCard({ evidence, index }: { evidence: SearchEvidence; index: number }) {
  const fileName = evidence.file.path.split(/[\\/]/).at(-1) || evidence.file.path
  return <article className="evidence-card">
    <div className="evidence-topline"><span className="evidence-index">{String(index).padStart(2, '0')}</span><div className="evidence-location"><span className="file-badge"><Icon name="code" size={14} />{evidence.file.language || fileName.split('.').at(-1) || 'file'}</span><strong title={evidence.file.path}>{evidence.file.path}</strong></div><div className="evidence-tags"><span className={`provenance provenance-${evidence.source.toLowerCase()}`}>{evidence.source}</span><span className="kind-tag">{evidence.kind === 'CODE_CHUNK' ? 'CODE' : evidence.relationship?.type || 'RELATIONSHIP'}</span></div></div>
    <div className="evidence-meta"><span className="line-range">Lines {evidence.startLine}–{evidence.endLine}</span>{evidence.symbol && <span className="symbol-reference"><span>{evidence.symbol.type}</span>{evidence.symbol.name}</span>}{typeof evidence.similarity === 'number' && <span className="similarity">Similarity {(evidence.similarity * 100).toFixed(1)}%</span>}</div>
    {evidence.relationship && <div className="relationship-detail"><span>{evidence.relationship.sourceSymbol.name}</span><b>{evidence.relationship.type}</b><span>{evidence.relationship.targetSymbol.name}</span></div>}
    {evidence.content && <pre className="code-snippet"><code>{evidence.content}</code></pre>}
  </article>
}
