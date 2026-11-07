import {ReactNode} from 'react'

export type IconName =
    | 'table' | 'view' | 'column' | 'pk' | 'index' | 'constraint' | 'schema' | 'folder' | 'folderOpen' | 'database'
    | 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'more'
    | 'postgres' | 'redis' | 'duckdb'
    | 'play' | 'stop' | 'plus' | 'close' | 'chevron' | 'save' | 'download' | 'gear' | 'copy' | 'trash' | 'edit' | 'refresh' | 'plug' | 'unplug'
    | 'pin' | 'check' | 'alert' | 'info' | 'logo'

const S = {fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round'} as const

const COLORS: Partial<Record<IconName, string>> = {
    table: '#6f9bd8', view: '#b08ad6', column: '#8f939b', pk: '#e5b95c', index: '#e0955a', constraint: '#9aa1ad', schema: '#8f939b',
    folder: '#8f939b', folderOpen: '#8f939b', database: '#8f939b', more: '#8f939b',
    string: '#6aab73', hash: '#cf8e6d', list: '#56a8f5', set: '#c77dbb', zset: '#e5b95c', stream: '#2aacb8',
    postgres: '#6f9bd8', redis: '#e5584f', duckdb: '#f2c55c',
    play: '#5fb760', stop: '#f75464', check: '#5fb760', alert: '#f75464', info: '#548af7',
}

const PATHS: Record<IconName, ReactNode> = {
    table: <g {...S}><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6.5 6.5V13"/></g>,
    view: <g {...S}><rect x="2" y="3" width="12" height="10" rx="1.5" strokeDasharray="2.2 1.6"/><path d="M2 6.5h12"/><circle cx="8" cy="10" r="1.2"/></g>,
    column: <g {...S}><rect x="5" y="2.5" width="6" height="11" rx="1"/><path d="M5 6h6"/></g>,
    pk: <g {...S}><circle cx="5.2" cy="10.8" r="2.6"/><path d="M7.1 9 13 3.1M11 5l1.6 1.6M9.2 6.8l1.4 1.4"/></g>,
    index: <path d="M9 1.8 3.8 9h3.6L6.8 14.2 12.2 7H8.6L9 1.8Z" fill="currentColor" stroke="currentColor" strokeWidth=".6" strokeLinejoin="round"/>,
    constraint: <g {...S}><rect x="3.5" y="7" width="9" height="6.5" rx="1.4"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></g>,
    schema: <g {...S}><path d="M8 2 13.5 5v6L8 14 2.5 11V5L8 2Z"/><path d="M2.5 5 8 8l5.5-3M8 8v6"/></g>,
    folder: <path {...S} d="M2 4.4c0-.7.5-1.2 1.2-1.2h2.9l1.3 1.5h5.4c.7 0 1.2.5 1.2 1.2v5.9c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2V4.4Z"/>,
    folderOpen: <path {...S} d="M2 12.4V4.4c0-.7.5-1.2 1.2-1.2h2.9l1.3 1.5h5.1c.7 0 1.2.5 1.2 1.2v1.4M2 12.4l1.7-5h10.1c.6 0 1 .5.9 1.1l-1.2 4.1c-.1.5-.6.8-1.1.8H3.2c-.7 0-1.2-.4-1.2-1Z"/>,
    database: <g {...S}><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/></g>,
    string: <g {...S}><path d="M2.5 5.5h5M2.5 8h11M2.5 10.5h8"/></g>,
    hash: <g {...S}><path d="M6 2.5 5 13.5M11 2.5l-1 11M2.8 6h10.4M2.8 10h10.4"/></g>,
    list: <g {...S}><path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.8" cy="4" r=".5" fill="currentColor"/><circle cx="2.8" cy="8" r=".5" fill="currentColor"/><circle cx="2.8" cy="12" r=".5" fill="currentColor"/></g>,
    set: <g {...S}><circle cx="6" cy="8" r="3.6"/><circle cx="10" cy="8" r="3.6"/></g>,
    zset: <g {...S}><path d="M3 13.5V10M6.5 13.5V7.5M10 13.5V5M13.5 13.5V2.5"/></g>,
    stream: <g {...S}><path d="M2 5.5c1.5-1.5 2.5-1.5 4 0s2.5 1.5 4 0 2.5-1.5 4 0M2 10.5c1.5-1.5 2.5-1.5 4 0s2.5 1.5 4 0 2.5-1.5 4 0"/></g>,
    more: <g fill="currentColor"><circle cx="3.5" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12.5" cy="8" r="1.1"/></g>,
    postgres: <g {...S}><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4"/><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" opacity=".6"/></g>,
    redis: <g {...S}><path d="M8 2.6 14 5 8 7.4 2 5 8 2.6Z"/><path d="M2 8l6 2.4L14 8M2 11l6 2.4 6-2.4"/></g>,
    duckdb: <g><circle cx="8" cy="8" r="6.2" fill="currentColor"/><circle cx="6.2" cy="6.6" r="1" fill="#1e1f22"/><path d="M9.6 7.4c1.6-.2 3.3.3 3.9 1.1-.6.9-2.3 1.2-3.9 1Z" fill="#e0a02a"/></g>,
    pin: <g {...S}><path d="M10.2 2.5 13.5 5.8l-1.4.7-2 2.2.3 3-.9.9-2.4-2.4-3.2 3.2M5.9 6.4l.9-.9 3-.3 2.2-2.2.7-1.4"/></g>,
    play: <path d="M4.8 2.8v10.4L13 8 4.8 2.8Z" fill="currentColor"/>,
    stop: <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor"/>,
    plus: <path {...S} strokeWidth={1.5} d="M8 3v10M3 8h10"/>,
    close: <path {...S} strokeWidth={1.5} d="m4 4 8 8M12 4l-8 8"/>,
    chevron: <path {...S} strokeWidth={1.5} d="m6 3.5 4.5 4.5L6 12.5"/>,
    save: <g {...S}><path d="M3 3.5c0-.3.2-.5.5-.5H11l2 2v7.5c0 .3-.2.5-.5.5h-9a.5.5 0 0 1-.5-.5v-9Z"/><path d="M5 3v3.2h5V3M5 13v-3.5h6V13"/></g>,
    download: <g {...S}><path d="M8 2.5v7.5M4.8 7.2 8 10.4l3.2-3.2M3 13h10"/></g>,
    gear: <g {...S}><circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2"/></g>,
    copy: <g {...S}><rect x="5.5" y="5.5" width="8" height="8" rx="1.3"/><path d="M10.5 5.5V3.8c0-.7-.5-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .8.6 1.3 1.3 1.3h1.7"/></g>,
    trash: <g {...S}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.3 4.5l.6 8.3c0 .4.4.7.8.7h4.6c.4 0 .8-.3.8-.7l.6-8.3M6.8 7v4M9.2 7v4"/></g>,
    edit: <g {...S}><path d="m10.5 3 2.5 2.5L5.8 12.7 2.8 13.2l.5-3L10.5 3Z"/></g>,
    refresh: <g {...S}><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.7h-2.7"/></g>,
    plug: <g {...S}><path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.3a3.5 3.5 0 0 1-7 0V5.5ZM8 11.3v2.2"/></g>,
    unplug: <g {...S}><path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.3a3.5 3.5 0 0 1-7 0V5.5ZM8 11.3v2.2M2.5 13.5l11-11"/></g>,
    check: <g {...S}><circle cx="8" cy="8" r="6"/><path d="m5.4 8.2 1.8 1.8 3.4-3.6"/></g>,
    alert: <g {...S}><circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.8"/><circle cx="8" cy="11.1" r=".4" fill="currentColor"/></g>,
    info: <g {...S}><circle cx="8" cy="8" r="6"/><path d="M8 7.3v3.9"/><circle cx="8" cy="4.9" r=".4" fill="currentColor"/></g>,
    logo: <g {...S} strokeWidth={1}><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/></g>,
}

export const kindIcon = (kind: string): IconName => (kind === 'redis' ? 'redis' : kind === 'duck' ? 'duckdb' : 'postgres')
export const redisTypeIcon = (type: string): IconName =>
    (['hash', 'list', 'set', 'zset', 'stream'].includes(type) ? type : 'string') as IconName

interface Props {
    name: IconName
    size?: number
    color?: string
    className?: string
    style?: React.CSSProperties
}

export function Icon({name, size = 16, color, className, style}: Props) {
    return (
        <svg className={`icon${className ? ' ' + className : ''}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"
             style={{color: color ?? COLORS[name], ...style}}>
            {PATHS[name]}
        </svg>
    )
}
