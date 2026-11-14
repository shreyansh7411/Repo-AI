import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { useTheme } from '../theme/useTheme'
import { Icon } from './Icons'

export function SettingsWorkspace() {
  const { user, updateProfile, changePassword } = useAuth()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState(user?.name ?? '')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileError(null)
    setProfileSuccess(null)
    const nextName = name.trim()
    if (!nextName || nextName.length > 120) { setProfileError('Name must be between 1 and 120 characters.'); return }
    setProfileBusy(true)
    try { await updateProfile(nextName); setName(nextName); setProfileSuccess('Your display name has been updated.') }
    catch (error) { setProfileError(error instanceof Error ? error.message : 'Profile could not be updated.') }
    finally { setProfileBusy(false) }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(null)
    if (newPassword.length < 12 || newPassword.length > 128) { setPasswordError('Use a new password between 12 and 128 characters.'); return }
    if (newPassword !== confirmPassword) { setPasswordError('The new passwords do not match.'); return }
    setPasswordBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setPasswordSuccess('Password changed. Other active sessions have been signed out.')
    } catch (error) { setPasswordError(error instanceof Error ? error.message : 'Password could not be changed.') }
    finally { setPasswordBusy(false) }
  }

  return <main className="main-content settings-workspace">
    <header className="workspace-header"><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>Settings</strong></div></header>
    <section className="settings-heading"><span className="section-kicker">YOUR ACCOUNT</span><h1>Account settings</h1><p>Manage your profile and personalize your workspace.</p></section>
    <div className="settings-grid">
      <section className="settings-card"><div className="settings-card-title"><span className="settings-icon"><Icon name="user" size={19} /></span><div><h2>Profile</h2><p>Your account identity in Repo-AI</p></div></div>
        <form className="settings-form" onSubmit={event => void saveProfile(event)}>
          <label className="settings-field"><span>Display name</span><input value={name} maxLength={120} autoComplete="name" onChange={event => setName(event.target.value)} required /></label>
          <label className="settings-field"><span>Email address</span><input value={user?.email ?? ''} readOnly aria-readonly="true" /><small>Email changes are not available yet.</small></label>
          {profileError && <div className="settings-message error-text" role="alert">{profileError}</div>}{profileSuccess && <div className="settings-message success" role="status">{profileSuccess}</div>}
          <button className="button-primary settings-submit" type="submit" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}<Icon name="arrow" size={15} /></button>
        </form>
      </section>

      <section className="settings-card"><div className="settings-card-title"><span className="settings-icon"><Icon name="lock" size={18} /></span><div><h2>Password</h2><p>Choose a strong password you do not reuse</p></div></div>
        <form className="settings-form" onSubmit={event => void savePassword(event)}>
          <label className="settings-field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
          <label className="settings-field"><span>New password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /><small>12–128 characters.</small></label>
          <label className="settings-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></label>
          {passwordError && <div className="settings-message error-text" role="alert">{passwordError}</div>}{passwordSuccess && <div className="settings-message success" role="status">{passwordSuccess}</div>}
          <button className="button-primary settings-submit" type="submit" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}<Icon name="arrow" size={15} /></button>
        </form>
      </section>

      <section className="settings-card appearance-card"><div className="settings-card-title"><span className="settings-icon"><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} /></span><div><h2>Appearance</h2><p>Choose how Repo-AI looks on this device</p></div></div>
        <div className="theme-choice" role="group" aria-label="Color theme"><button type="button" className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')} aria-pressed={theme === 'light'}><Icon name="sun" size={17} /><span><strong>Light</strong><small>Bright surfaces</small></span>{theme === 'light' && <Icon name="check" size={16} />}</button><button type="button" className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'}><Icon name="moon" size={17} /><span><strong>Dark</strong><small>Low-light workspace</small></span>{theme === 'dark' && <Icon name="check" size={16} />}</button></div>
      </section>
    </div>
    <footer className="workspace-footer"><span>Passwords are hashed by the backend. Session cookies remain inaccessible to browser JavaScript.</span></footer>
  </main>
}
