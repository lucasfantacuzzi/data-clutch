import {Dialog} from './Dialog'

interface Props {
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
    onCancel: () => void
}

export function ConfirmDialog({title, message, confirmLabel, danger, onConfirm, onCancel}: Props) {
    return (
        <Dialog title={title} icon={danger ? 'alert' : 'info'} width={420} onClose={onCancel}
                footer={<>
                    <div className="spacer"/>
                    <button className="btn" autoFocus onClick={onCancel}>Cancel</button>
                    <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
                </>}>
            <div className="confirm-body">{message}</div>
        </Dialog>
    )
}
