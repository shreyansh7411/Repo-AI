import type { AuthUser, RepositorySummary } from '../api/client'
import { NavLink } from 'react-router-dom'
import { Icon } from './Icons'

type WorkspaceView = 'dashboard' | 'explorer' | 'symbols' | 'callers' | 'impact' | 'paths' | 'assistant' | 'settings'

interface Props {
  repositories: RepositorySummary[]
  selectedId: string | null
  loading: boolean
  error: string | null
  activeView: WorkspaceView
  onSelect: (repositoryId: string) => void
  onRefresh: () => void
  onAdd: () => void
  user: AuthUser
  onLogout: () => void
}

export function RepositorySidebar({ repositories, selectedId, loading, error, activeView, onSelect, onRefresh, onAdd, user, onLogout }: Props) {
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

    <nav className="workspace-nav" aria-label="Repository views">
      <span className="nav-section-label">EXPLORE</span>
      <NavLink to="/dashboard" className={`workspace-nav-item${activeView === 'dashboard' ? ' active' : ''}`} aria-current={activeView === 'dashboard' ? 'page' : undefined}><Icon name="folder" size={16} />Dashboard</NavLink>
      <NavLink to="/explorer" className={`workspace-nav-item${activeView === 'explorer' ? ' active' : ''}`} aria-current={activeView === 'explorer' ? 'page' : undefined}><Icon name="search" size={16} />Search</NavLink>
      <NavLink to="/symbols" className={`workspace-nav-item${activeView === 'symbols' ? ' active' : ''}`} aria-current={activeView === 'symbols' ? 'page' : undefined}><Icon name="code" size={16} />Symbols</NavLink>
      <NavLink to="/callers" className={`workspace-nav-item${activeView === 'callers' ? ' active' : ''}`} aria-current={activeView === 'callers' ? 'page' : undefined}><Icon name="arrow" size={16} />Callers</NavLink>
      <NavLink to="/impact" className={`workspace-nav-item${activeView === 'impact' ? ' active' : ''}`} aria-current={activeView === 'impact' ? 'page' : undefined}><Icon name="refresh" size={16} />Impact</NavLink>
      <NavLink to="/paths" className={`workspace-nav-item${activeView === 'paths' ? ' active' : ''}`} aria-current={activeView === 'paths' ? 'page' : undefined}><Icon name="folder" size={16} />Paths</NavLink>
      <NavLink to="/assistant" className={`workspace-nav-item${activeView === 'assistant' ? ' active' : ''}`} aria-current={activeView === 'assistant' ? 'page' : undefined}><Icon name="brand" size={16} />Assistant</NavLink>
    </nav>

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
    </div>
  </aside>
}
