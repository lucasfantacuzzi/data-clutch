import * as monaco from 'monaco-editor'
import {loader} from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

// Bundle Monaco locally (no CDN): the desktop app must work offline.
;(self as any).MonacoEnvironment = {getWorker: () => new EditorWorker()}
loader.config({monaco})

monaco.languages.register({id: 'redis'})
monaco.languages.setMonarchTokensProvider('redis', {
    ignoreCase: true,
    tokenizer: {
        root: [
            [/^\s*[a-z]+/, 'keyword'],
            [/#.*$/, 'comment'],
            [/"([^"\\]|\\.)*"/, 'string'],
            [/'([^'\\]|\\.)*'/, 'string'],
            [/[+-]?\d+(\.\d+)?\b/, 'number'],
            [/[*?]/, 'operator'],
        ],
    },
})

monaco.editor.defineTheme('darcula', {
    base: 'vs-dark',
    inherit: true,
    rules: [
        {token: '', foreground: 'bcbec4'},
        {token: 'keyword', foreground: 'cf8e6d'},
        {token: 'keyword.sql', foreground: 'cf8e6d'},
        {token: 'operator.sql', foreground: 'bcbec4'},
        {token: 'operator', foreground: 'bcbec4'},
        {token: 'string', foreground: '6aab73'},
        {token: 'string.sql', foreground: '6aab73'},
        {token: 'string.double', foreground: '6aab73'},
        {token: 'string.escape', foreground: 'cf8e6d'},
        {token: 'number', foreground: '2aacb8'},
        {token: 'number.sql', foreground: '2aacb8'},
        {token: 'comment', foreground: '868a91', fontStyle: 'italic'},
        {token: 'comment.quote', foreground: '868a91', fontStyle: 'italic'},
        {token: 'comment.sql', foreground: '868a91', fontStyle: 'italic'},
        {token: 'predefined.sql', foreground: '56a8f5'},
        {token: 'identifier', foreground: 'bcbec4'},
        {token: 'identifier.quote', foreground: 'c77dbb'},
        {token: 'identifier.sql', foreground: 'bcbec4'},
        {token: 'delimiter', foreground: 'bcbec4'},
        {token: 'delimiter.parenthesis', foreground: 'bcbec4'},
        {token: 'delimiter.parenthesis.sql', foreground: 'bcbec4'},
    ],
    colors: {
        'editor.background': '#1e1f22',
        'editor.foreground': '#bcbec4',
        'editorGutter.background': '#1e1f22',
        'editorLineNumber.foreground': '#82868d',
        'editorLineNumber.activeForeground': '#bcbec4',
        'editor.lineHighlightBackground': '#24262b',
        'editor.lineHighlightBorder': '#24262b',
        'editorCursor.foreground': '#ced0d6',
        'editor.selectionBackground': '#214283',
        'editor.inactiveSelectionBackground': '#2b3a5c',
        'editor.selectionHighlightBackground': '#3a4a6e66',
        'editor.wordHighlightBackground': '#3a4a6e66',
        'editor.findMatchBackground': '#5c4a1f',
        'editor.findMatchHighlightBackground': '#5c4a1f66',
        'editorBracketMatch.background': '#3b514d',
        'editorBracketMatch.border': '#3b514d',
        'editorIndentGuide.background1': '#2b2d30',
        'editorIndentGuide.activeBackground1': '#43454a',
        'editorWhitespace.foreground': '#393b40',
        'editorWidget.background': '#2b2d30',
        'editorWidget.border': '#43454a',
        'editorWidget.foreground': '#dfe1e5',
        'editorHoverWidget.background': '#2b2d30',
        'editorHoverWidget.border': '#43454a',
        'editorSuggestWidget.background': '#2b2d30',
        'editorSuggestWidget.border': '#43454a',
        'editorSuggestWidget.foreground': '#dfe1e5',
        'editorSuggestWidget.selectedBackground': '#2e436e',
        'editorSuggestWidget.selectedForeground': '#ffffff',
        'editorSuggestWidget.highlightForeground': '#6a9bf8',
        'editorSuggestWidget.focusHighlightForeground': '#8db4ff',
        'list.hoverBackground': '#393b40',
        'list.activeSelectionBackground': '#2e436e',
        'list.focusBackground': '#2e436e',
        'input.background': '#1e1f22',
        'input.border': '#43454a',
        'focusBorder': '#3574f0',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#4e515766',
        'scrollbarSlider.hoverBackground': '#4e5157aa',
        'scrollbarSlider.activeBackground': '#6f737acc',
        'editorOverviewRuler.border': '#00000000',
        'editorError.foreground': '#f75464',
        'editorWarning.foreground': '#e5a50a',
        'menu.background': '#2b2d30',
        'menu.foreground': '#dfe1e5',
        'menu.selectionBackground': '#2e436e',
    },
})

monaco.editor.defineTheme('clutch-light', {
    base: 'vs',
    inherit: true,
    rules: [
        {token: '', foreground: '080808'},
        {token: 'keyword', foreground: '0033b3'},
        {token: 'keyword.sql', foreground: '0033b3'},
        {token: 'string', foreground: '067d17'},
        {token: 'string.sql', foreground: '067d17'},
        {token: 'string.double', foreground: '067d17'},
        {token: 'number', foreground: '1750eb'},
        {token: 'number.sql', foreground: '1750eb'},
        {token: 'comment', foreground: '8c8c8c', fontStyle: 'italic'},
        {token: 'comment.sql', foreground: '8c8c8c', fontStyle: 'italic'},
        {token: 'predefined.sql', foreground: '00627a'},
        {token: 'identifier.quote', foreground: '871094'},
    ],
    colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#080808',
        'editorGutter.background': '#ffffff',
        'editorLineNumber.foreground': '#aeb3c2',
        'editorLineNumber.activeForeground': '#4b4d54',
        'editor.lineHighlightBackground': '#f5f8fe',
        'editor.lineHighlightBorder': '#f5f8fe',
        'editor.selectionBackground': '#a6d2ff',
        'editor.inactiveSelectionBackground': '#d4e2ff',
        'editorWidget.background': '#f7f8fa',
        'editorWidget.border': '#d3d5db',
        'editorSuggestWidget.background': '#f7f8fa',
        'editorSuggestWidget.border': '#d3d5db',
        'editorSuggestWidget.selectedBackground': '#d4e2ff',
        'list.hoverBackground': '#eceef2',
        'list.activeSelectionBackground': '#d4e2ff',
        'input.background': '#ffffff',
        'input.border': '#c4c6cc',
        'focusBorder': '#3574f0',
        'editorOverviewRuler.border': '#00000000',
        'menu.background': '#f7f8fa',
        'menu.selectionBackground': '#d4e2ff',
    },
})

// The editor that last had focus: menu actions (Undo, Find...) target it.
let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null
export const setActiveEditor = (e: monaco.editor.IStandaloneCodeEditor | null) => { activeEditor = e }
export const getActiveEditor = () => activeEditor

export {monaco}
