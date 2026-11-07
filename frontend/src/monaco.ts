import * as monaco from 'monaco-editor'
import {loader} from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

// Bundle Monaco locally (no CDN): the desktop app must work offline.
;(self as any).MonacoEnvironment = {getWorker: () => new EditorWorker()}
loader.config({monaco})

monaco.editor.defineTheme('darcula', {
    base: 'vs-dark',
    inherit: true,
    rules: [
        {token: 'keyword', foreground: 'cc7832'},
        {token: 'keyword.sql', foreground: 'cc7832'},
        {token: 'operator.sql', foreground: 'a9b7c6'},
        {token: 'string', foreground: '6a8759'},
        {token: 'string.sql', foreground: '6a8759'},
        {token: 'number', foreground: '6897bb'},
        {token: 'comment', foreground: '808080'},
        {token: 'predefined.sql', foreground: 'ffc66d'},
        {token: 'identifier', foreground: 'a9b7c6'},
    ],
    colors: {
        'editor.background': '#1e1f22',
        'editor.foreground': '#bcbec4',
        'editorLineNumber.foreground': '#4b5059',
        'editor.lineHighlightBackground': '#26282e',
        'editorCursor.foreground': '#ced0d6',
        'editor.selectionBackground': '#214283',
        'editorSuggestWidget.background': '#2b2d30',
        'editorSuggestWidget.border': '#4e5157',
        'editorSuggestWidget.selectedBackground': '#2e436e',
    },
})

export {monaco}
