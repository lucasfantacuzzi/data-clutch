import {useEffect, useRef} from 'react'
import {Icon} from './Icons'
import {Entry, clearLog, markRead, useLog} from './log'

const fmt = (e: Entry) => `${new Date(e.time).toLocaleTimeString()} [${e.source}] ${e.text}`

export function OutputPanel({onClose}: {onClose: () => void}) {
    const {entries} = useLog()
    const end = useRef<HTMLDivElement>(null)
    // anything visible here counts as read
    useEffect(() => { markRead(); end.current?.scrollIntoView({block: 'end'}) }, [entries])
    return (
        <div className="output-panel" role="region" aria-label="Output">
            <div className="output-head">
                <span className="title">Output</span><span className="spacer"/>
                <button className="icon-btn" title="Copy all" aria-label="Copy all" disabled={!entries.length}
                        onClick={() => navigator.clipboard?.writeText(entries.map(fmt).join('\n')).catch(() => {})}><Icon name="copy" color="currentColor"/></button>
                <button className="icon-btn" title="Clear" aria-label="Clear" disabled={!entries.length} onClick={clearLog}><Icon name="trash" color="currentColor"/></button>
                <button className="icon-btn" title="Close" aria-label="Close output" onClick={onClose}><Icon name="close" size={12}/></button>
            </div>
            <div className="output-body">
                {entries.length === 0 && <div className="output-empty">No messages.</div>}
                {entries.map(e => (
                    <div key={e.id} className={`output-line ${e.level}`}>
                        <span className="o-time">{new Date(e.time).toLocaleTimeString()}</span>
                        <span className="o-src">{e.source}</span>
                        <span className="o-text">{e.text}</span>
                    </div>
                ))}
                <div ref={end}/>
            </div>
        </div>
    )
}
