import {Icon} from './Icons'
import {baseName} from './FileTree'
import {fmtCombo} from './keybindings'

interface Props {
    recent: string[]
    keys: {run: string; open: string; folder: string; neu: string}
    onOpenFolder: () => void
    onOpenRecent: (dir: string) => void
    onOpenFile: () => void
    onNew: () => void
}

export function Welcome({recent, keys, onOpenFolder, onOpenRecent, onOpenFile, onNew}: Props) {
    return (
        <div className="welcome">
            <Icon name="logo" size={44} color="var(--text-disabled)"/>
            <div className="welcome-title">data-clutch</div>
            <div className="welcome-sub">Connect to a database, or open a folder of scripts</div>
            <div className="welcome-actions">
                <button className="btn" onClick={onOpenFolder}><Icon name="folderOpen" size={14}/>Open folder<kbd>{fmtCombo(keys.folder)}</kbd></button>
                <button className="btn" onClick={onOpenFile}><Icon name="file" size={14}/>Open file<kbd>{fmtCombo(keys.open)}</kbd></button>
                <button className="btn" onClick={onNew}><Icon name="newFile" size={14}/>New query<kbd>{fmtCombo(keys.neu)}</kbd></button>
            </div>
            {recent.length > 0 && (
                <div className="welcome-recent">
                    <div className="welcome-h">Recent folders</div>
                    {recent.slice(0, 6).map(r => (
                        <button key={r} className="recent" title={r} onClick={() => onOpenRecent(r)}>
                            <Icon name="folder" size={14}/><span className="r-name">{baseName(r)}</span><span className="r-path">{r}</span>
                        </button>
                    ))}
                </div>
            )}
            <div className="welcome-keys">
                <span>Connect</span><span><kbd>Double-click</kbd> a connection</span>
                <span>Open a table or key</span><span><kbd>Double-click</kbd> it in the tree</span>
                <span>Run a query</span><span><kbd>{fmtCombo(keys.run)}</kbd></span>
            </div>
        </div>
    )
}
