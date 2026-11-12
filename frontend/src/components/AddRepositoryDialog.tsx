import { useState, type FormEvent } from 'react'
import { repositoryNameFromUrl, validateGitUrl } from '../api/client'
import { Icon } from './Icons'

interface Props { busy: boolean; error: string | null; onClose: () => void; onSubmit: (name: string, url: string) => void }

export function AddRepositoryDialog({ busy, error, onClose, onSubmit }: Props) {
  const [url, setUrl] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidationError(null)
    try {
      const validatedUrl = validateGitUrl(url)
      onSubmit(repositoryNameFromUrl(validatedUrl), validatedUrl)
    } catch (reason) {
      setValidationError(reason instanceof Error ? reason.message : 'Enter a valid repository URL.')
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="add-repository-title">
      <button className="dialog-close icon-button" type="button" onClick={onClose} aria-label="Close dialog" disabled={busy}><Icon name="close" /></button>
      <div className="dialog-icon"><Icon name="code" size={21} /></div>
      <p className="eyebrow">NEW WORKSPACE</p>
      <h2 id="add-repository-title">Add a repository</h2>
      <p className="dialog-description">Connect a Git repository. We’ll index its files, symbols, and relationships so you can search the code.</p>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="repository-url">Git repository URL</label>
        <input id="repository-url" className="text-input" autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/org/project.git" disabled={busy} />
        <p className="field-hint">HTTPS, SSH, Git, and local Git URLs are supported.</p>
        {(validationError || error) && <div className="inline-error" role="alert">{validationError || error}</div>}
        {busy && <div className="indexing-note"><Icon name="spinner" />Indexing repository. This can take a few minutes for larger codebases.</div>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button-primary" disabled={busy || !url.trim()}>{busy ? <><Icon name="spinner" size={16} />Indexing…</> : <>Index repository <Icon name="arrow" size={16} /></>}</button>
        </div>
      </form>
    </section>
  </div>
}
