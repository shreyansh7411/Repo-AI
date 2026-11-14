import { Link } from 'react-router-dom'
import { Icon } from './Icons'
import { useTheme } from '../theme/useTheme'

interface Props {
  settingsActive?: boolean
}

export function WorkspaceHeaderActions({ settingsActive = false }: Props) {
  const { theme, toggleTheme } = useTheme()

  return <div className="workspace-header-actions">
    <Link
      className={`workspace-account-link${settingsActive ? ' active' : ''}`}
      to="/settings"
      aria-current={settingsActive ? 'page' : undefined}
    >
      <Icon name="user" size={15} />
      <span>Account settings</span>
    </Link>
    <button
      className="workspace-theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  </div>
}
