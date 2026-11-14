import type { ReactNode } from 'react'

interface IconProps { name: 'brand' | 'plus' | 'refresh' | 'search' | 'code' | 'folder' | 'arrow' | 'close' | 'spinner' | 'spark' | 'layers' | 'flow' | 'graph' | 'user' | 'book' | 'moon' | 'sun' | 'lock' | 'check' | 'external'; size?: number }

export function Icon({ name, size = 18 }: IconProps) {
  const paths: Record<IconProps['name'], ReactNode> = {
    brand: <><path d="M12 2.8 20.5 7.4v9.2L12 21.2l-8.5-4.6V7.4L12 2.8Z" /><path d="m7.8 12 2.7 2.7 5.7-6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.7 9a7 7 0 0 1 11.5-2L20 12M4 12l2.8 5a7 7 0 0 0 11.5-2" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></>,
    code: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4m-2-9-4 10" /></>,
    folder: <><path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h5l2 2H19a2 2 0 0 1 2 2v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    spinner: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    flow: <><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /><path d="M10 7h2a3 3 0 0 1 3 3v4M12 14l3 3 3-3" /></>,
    graph: <><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="7" r="2.2" /><circle cx="12" cy="18" r="2.2" /><path d="m8 7 7.8-.1M7.4 8 11 16m5.4-7.1L13 16" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.2 3.3-5 7-5s6.2 1.8 7 5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8" /></>,
    moon: <><path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.7 8.5 8.5 0 1 0 20.5 15.5Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    external: <><path d="M14 4h6v6m0-6-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  }

  return <svg className={name === 'spinner' ? 'icon icon-spin' : 'icon'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
