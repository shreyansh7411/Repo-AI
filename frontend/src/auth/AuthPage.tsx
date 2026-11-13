import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { Icon } from '../components/Icons'
import './AuthPage.css'

interface Props {
  mode: 'login' | 'register'
}

export function AuthPage({ mode }: Props) {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRegister = mode === 'register'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const normalizedEmail = email.trim()
    if (isRegister && (!name.trim() || name.trim().length > 120)) {
      setError('Enter a name between 1 and 120 characters.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 320) {
      setError('Enter a valid email address.')
      return
    }
    if (isRegister && (password.length < 12 || password.length > 128)) {
      setError('Use a password between 12 and 128 characters.')
      return
    }
    if (!isRegister && (!password || password.length > 128)) {
      setError('Enter your password.')
      return
    }
    if (isRegister && password !== confirmation) {
      setError('The passwords do not match.')
      return
    }

    setBusy(true)
    try {
      if (isRegister) await register(name.trim(), normalizedEmail, password)
      else await login(normalizedEmail, password)
      navigate('/dashboard', { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <div className="auth-backdrop-glow" />
    <section className="auth-card" aria-labelledby="auth-title">
      <Link className="auth-brand" to="/dashboard">
        <span className="auth-brand-mark"><Icon name="brand" size={22} /></span>
        <span><strong>repo<span>·</span>ai</strong><small>REPOSITORY INTELLIGENCE</small></span>
      </Link>

      <div className="auth-intro">
        <p className="eyebrow">PRIVATE CODE WORKSPACE</p>
        <h1 id="auth-title">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
        <p>{isRegister ? 'Set up an account to keep your indexed repositories private to you.' : 'Sign in to continue to your repository workspace.'}</p>
      </div>

      <form className="auth-form" onSubmit={event => void submit(event)} noValidate>
        {isRegister && <div className="auth-field">
          <label htmlFor="auth-name">Name</label>
          <input id="auth-name" name="name" type="text" autoComplete="name" maxLength={120} value={name} onChange={event => setName(event.target.value)} required />
        </div>}
        <div className="auth-field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} required />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-password">Password</label>
          <div className="auth-password-wrap">
            <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required />
            <button className="auth-visibility" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          {isRegister && <span className="auth-field-hint">At least 12 characters.</span>}
        </div>
        {isRegister && <div className="auth-field">
          <label htmlFor="auth-confirmation">Confirm password</label>
          <input id="auth-confirmation" name="confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required />
        </div>}

        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? <><span className="auth-spinner" />{isRegister ? 'Creating account…' : 'Signing in…'}</> : <>{isRegister ? 'Create account' : 'Sign in'}<Icon name="arrow" size={16} /></>}
        </button>
      </form>

      <p className="auth-switch">
        {isRegister ? 'Already have an account?' : 'New to Repo-AI?'}{' '}
        <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link>
      </p>
      <div className="auth-security-note"><span className="auth-security-dot" />Sessions use secure, HttpOnly cookies.</div>
    </section>
    <footer className="auth-footer">DETERMINISTIC REPOSITORY INTELLIGENCE</footer>
  </main>
}
