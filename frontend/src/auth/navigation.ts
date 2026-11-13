const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function subscribeToPath(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', notify)
    window.addEventListener('hashchange', notify)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', notify)
        window.removeEventListener('hashchange', notify)
  }
}

export function getCurrentPath(): string {
  const hashPath = window.location.hash.slice(1)
  return hashPath.startsWith('/') ? hashPath : '/'
}

export function navigate(path: string, replace = false): void {
  if (getCurrentPath() === path) return
  const hashPath = `#${path}`
  if (replace) window.history.replaceState(null, '', hashPath)
  else window.history.pushState(null, '', hashPath)
  notify()
}
