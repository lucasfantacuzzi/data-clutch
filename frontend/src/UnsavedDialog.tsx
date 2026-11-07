import {Dialog} from './Dialog'

export function UnsavedDialog({name, onSave, onDiscard, onCancel}: {name: string; onSave: () => void; onDiscard: () => void; onCancel: () => void}) {
    return (
        <Dialog title="Unsaved changes" icon="alert" width={440} onClose={onCancel}
                footer={<>
                    <div className="spacer"/>
                    <button className="btn" onClick={onCancel}>Cancel</button>
                    <button className="btn danger" onClick={onDiscard}>Don't save</button>
                    <button className="btn primary" autoFocus onClick={onSave}>Save</button>
                </>}>
            <div className="confirm-body">Save changes to "{name}" before closing?</div>
        </Dialog>
    )
}
