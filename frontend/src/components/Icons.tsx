import type { ReactNode } from 'react'

interface IconProps { name: 'brand' | 'plus' | 'refresh' | 'search' | 'code' | 'folder' | 'arrow' | 'close' | 'spinner'; size?: number }

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
  }

  return <svg className={name === 'spinner' ? 'icon icon-spin' : 'icon'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
