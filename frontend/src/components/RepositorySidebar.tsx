import type { AuthUser, RepositorySummary } from '../api/client'
import { Icon } from './Icons'

interface Props {
  repositories: RepositorySummary[]
  selectedId: string | null
  loading: boolean
  error: string | null
  connectionState: 'checking' | 'connected' | 'error'
  activeView: 'search' | 'symbols'
  onViewChange: (view: 'search' | 'symbols') => void
  onSelect: (repositoryId: string) => void
  onRefresh: () => void
  onAdd: () => void
  user: AuthUser
  onLogout: () => void
}

export function RepositorySidebar({ repositories, selectedId, loading, error, connectionState, activeView, onViewChange, onSelect, onRefresh, onAdd, user, onLogout }: Props) {
  return <aside className="sidebar">
    <div className="brand-lockup">
      <div className="brand-mark"><Icon name="brand" size={22} /></div>
      <div><div className="brand-name">repo<span>·</span>ai</div><div className="brand-caption">REPOSITORY INTELLIGENCE</div></div>
    </div>

    <div className="sidebar-section-heading">
      <div><span className="eyebrow">WORKSPACE</span><span className="repo-count">{repositories.length}</span></div>
      <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh repositories" title="Refresh repositories" disabled={loading}>
        <Icon name="refresh" size={16} />
      </button>
    </div>

    <button className="add-repository-button" type="button" onClick={onAdd}>
      <Icon name="plus" size={17} /><span>Add repository</span><span className="shortcut">⌘ K</span>
    </button>

    {selectedId && <nav className="workspace-nav" aria-label="Repository views">
      <span className="nav-section-label">EXPLORE</span>
      <button type="button" className={`workspace-nav-item${activeView === 'search' ? ' active' : ''}`} onClick={() => onViewChange('search')} aria-current={activeView === 'search' ? 'page' : undefined}><Icon name="search" size={16} />Search</button>
      <button type="button" className={`workspace-nav-item${activeView === 'symbols' ? ' active' : ''}`} onClick={() => onViewChange('symbols')} aria-current={activeView === 'symbols' ? 'page' : undefined}><Icon name="code" size={16} />Symbols</button>
    </nav>}

    <div className="repository-list" aria-label="Repositories">
      {loading && repositories.length === 0 && <div className="sidebar-state"><Icon name="spinner" />Loading repositories…</div>}
      {error && repositories.length === 0 && <div className="sidebar-state error-text">{error}</div>}
      {!loading && !error && repositories.length === 0 && <div className="sidebar-state">No repositories yet. Add a Git repository to begin.</div>}
      {repositories.map(repository => <button
        key={repository.repositoryId}
        type="button"
        className={`repository-row${selectedId === repository.repositoryId ? ' selected' : ''}`}
        onClick={() => onSelect(repository.repositoryId)}
        aria-current={selectedId === repository.repositoryId ? 'page' : undefined}
      >
        <span className="repo-avatar"><Icon name="folder" size={16} /></span>
        <span className="repo-row-copy">
          <span className="repo-row-name">{repository.name}</span>
          <span className="repo-row-meta"><span className={`status-dot ${repository.indexingStatus === 'INDEXED' ? 'ready' : 'pending'}`} />{repository.indexingStatus === 'INDEXED' ? 'Indexed' : 'Not indexed'}<span className="meta-divider">·</span>{repository.fileCount} files</span>
        </span>
      </button>)}
    </div>

    <div className="sidebar-footer">
      <div className="signed-in-user"><span className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="signed-in-copy"><strong>{user.name}</strong><small>{user.email}</small></span><button className="sign-out-button" type="button" onClick={onLogout}>Sign out</button></div>
      <span className="connection-indicator"><span className={`status-dot ${connectionState === 'connected' ? 'ready' : connectionState === 'error' ? 'offline' : 'pending'}`} />{connectionState === 'connected' ? 'API connected' : connectionState === 'error' ? 'API unavailable' : 'Connecting to API'}</span>
      <span className="version-label">MILESTONE 9A</span>
    </div>
  </aside>
}
