import {ReactNode, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Icon, IconName} from './Icons'

export function ContextMenu({x, y, onClose, children}: {x: number; y: number; onClose: () => void; children: ReactNode}) {
    const ref = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState({left: x, top: y})
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        setPos({left: Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4)), top: Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4))})
    }, [x, y])
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])
    return <div ref={ref} className="menu" role="menu" style={pos} onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>{children}</div>
}

export function MenuItem({icon, hint, danger, checked, onClick, children}: {icon?: IconName; hint?: string; danger?: boolean; checked?: boolean; onClick: () => void; children: ReactNode}) {
    return (
        <div className={`menu-item${danger ? ' danger' : ''}`} role="menuitem" tabIndex={0} onClick={onClick}
             onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
            <span className="mi-ico">{checked ? <Icon name="check" size={14} color="currentColor"/> : icon && <Icon name={icon} size={14} color="currentColor"/>}</span>
            <span className="mi-label">{children}</span>
            {hint && <span className="mi-hint">{hint}</span>}
        </div>
    )
}
