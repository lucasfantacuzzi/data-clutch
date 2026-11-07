import {ReactNode, useEffect, useRef, useState} from 'react'
import {ContextMenu, MenuItem} from './ContextMenu'

export interface MenuEntry {
    label: string
    hint?: string
    checked?: boolean
    disabled?: boolean
    run: () => void
}
export type MenuDef = {label: string; items: (MenuEntry | '-' | {header: string})[]}

// File / Edit / View strip. Opens on click, then follows the pointer between menus.
export function MenuBar({menus}: {menus: MenuDef[]}) {
    const [open, setOpen] = useState(-1)
    const [pos, setPos] = useState({x: 0, y: 0})
    const btns = useRef<(HTMLButtonElement | null)[]>([])

    const show = (i: number) => {
        const r = btns.current[i]?.getBoundingClientRect()
        if (r) setPos({x: r.left, y: r.bottom})
        setOpen(i)
    }
    useEffect(() => {
        if (open < 0) return
        const close = () => setOpen(-1)
        window.addEventListener('click', close)
        window.addEventListener('blur', close)
        return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
    }, [open])

    const m = open >= 0 ? menus[open] : null
    return (
        <div className="menubar" role="menubar">
            {menus.map((mm, i) => (
                <button key={mm.label} ref={el => { btns.current[i] = el }} role="menuitem" aria-haspopup="menu" aria-expanded={open === i}
                        className={open === i ? 'open' : ''}
                        onClick={e => { e.stopPropagation(); open === i ? setOpen(-1) : show(i) }}
                        onMouseEnter={() => open >= 0 && open !== i && show(i)}>
                    {mm.label}
                </button>
            ))}
            {m && (
                <ContextMenu x={pos.x} y={pos.y} onClose={() => setOpen(-1)}>
                    {m.items.map((it, i): ReactNode => {
                        if (it === '-') return <hr key={i}/>
                        if ('header' in it) return <div key={i} className="menu-header">{it.header}</div>
                        return (
                            <div key={i} style={it.disabled ? {opacity: .45, pointerEvents: 'none'} : undefined}>
                                <MenuItem hint={it.hint} checked={it.checked} onClick={() => { setOpen(-1); it.run() }}>{it.label}</MenuItem>
                            </div>
                        )
                    })}
                </ContextMenu>
            )}
        </div>
    )
}
