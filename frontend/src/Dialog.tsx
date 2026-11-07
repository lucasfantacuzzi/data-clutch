import {ReactNode, useEffect, useRef} from 'react'
import {Icon, IconName} from './Icons'

interface Props {
    title: string
    icon?: IconName
    width?: number
    busy?: boolean
    onClose: () => void
    footer?: ReactNode
    children: ReactNode
}

export function Dialog({title, icon, width = 520, busy, onClose, footer, children}: Props) {
    const closeRef = useRef(onClose)
    closeRef.current = onClose
    const busyRef = useRef(busy)
    busyRef.current = busy

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busyRef.current) { e.stopPropagation(); closeRef.current() }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    return (
        <div className="overlay" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
            <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{width}}>
                <div className="dialog-head">
                    {icon && <Icon name={icon}/>}
                    <h2>{title}</h2>
                    <button className="icon-btn" title="Close (Esc)" aria-label="Close" disabled={busy} onClick={onClose}><Icon name="close" size={14}/></button>
                </div>
                {children}
                {footer && <div className="foot">{footer}</div>}
            </div>
        </div>
    )
}

export function Notice({kind, children}: {kind: 'ok' | 'fail'; children: ReactNode}) {
    return (
        <div className={`full notice ${kind}`} role={kind === 'fail' ? 'alert' : 'status'}>
            <Icon name={kind === 'ok' ? 'check' : 'alert'} color="currentColor"/>
            <div className="notice-body">{children}</div>
        </div>
    )
}
