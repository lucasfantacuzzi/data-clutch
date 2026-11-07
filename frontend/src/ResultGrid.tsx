import {useEffect, useMemo, useRef, useState} from 'react'
import {AgGridReact} from 'ag-grid-react'
import {AllCommunityModule, ColDef, GridApi, IHeaderParams, ModuleRegistry, colorSchemeDark, colorSchemeLight, themeQuartz} from 'ag-grid-community'
import {Result} from './types'
import {usePrefs} from './prefs'

ModuleRegistry.registerModules([AllCommunityModule])

const darkParams = {
    backgroundColor: '#1e1f22',
    foregroundColor: '#bcbec4',
    accentColor: '#3574f0',
    headerBackgroundColor: '#2b2d30',
    headerTextColor: '#dfe1e5',
    oddRowBackgroundColor: '#212226',
    borderColor: '#2f3236',
    headerColumnBorder: {color: '#393b40'},
    headerRowBorder: {color: '#43454a'},
    columnBorder: {color: '#2a2c30'},
    headerColumnResizeHandleColor: '#4e5157',
    rowHoverColor: '#2e436e55',
    selectedRowBackgroundColor: '#2e436e',
    rangeSelectionBorderColor: '#548af7',
    rangeSelectionBackgroundColor: '#3574f033',
}
const lightParams = {
    backgroundColor: '#ffffff',
    foregroundColor: '#1e1f22',
    accentColor: '#3574f0',
    headerBackgroundColor: '#f7f8fa',
    headerTextColor: '#1e1f22',
    oddRowBackgroundColor: '#f9fafb',
    borderColor: '#e1e3e8',
    headerColumnBorder: {color: '#e1e3e8'},
    headerRowBorder: {color: '#d3d5db'},
    columnBorder: {color: '#eceef2'},
    headerColumnResizeHandleColor: '#c4c6cc',
    rowHoverColor: '#d4e2ff88',
    selectedRowBackgroundColor: '#d4e2ff',
    rangeSelectionBorderColor: '#3574f0',
    rangeSelectionBackgroundColor: '#3574f033',
}

const makeTheme = (dark: boolean, fontFamily: string, fontSize: number, compact: boolean) =>
    themeQuartz.withPart(dark ? colorSchemeDark : colorSchemeLight).withParams({
        ...(dark ? darkParams : lightParams),
        headerFontWeight: 600,
        headerFontSize: 12,
        wrapperBorder: false,
        wrapperBorderRadius: 0,
        rowBorder: false,
        cellHorizontalPadding: 10,
        fontSize: fontSize - 0.5,
        rowHeight: compact ? 20 : 24,
        headerHeight: compact ? 34 : 40,
        fontFamily,
    })

// Column header: name on top, SQL type underneath. Sorting is driven here because a custom header replaces the default one.
function TypedHeader(p: IHeaderParams & {colType?: string}) {
    const [sort, setSort] = useState(p.column.getSort())
    useEffect(() => {
        const on = () => setSort(p.column.getSort())
        p.column.addEventListener('sortChanged', on)
        return () => p.column.removeEventListener('sortChanged', on)
    }, [p.column])
    return (
        <div className="th" onClick={e => p.enableSorting && p.progressSort(e.shiftKey)} title={p.colType ? `${p.displayName}: ${p.colType}` : p.displayName}>
            <div className="th-name">
                <span>{p.displayName}</span>
                {sort && <span className="th-sort">{sort === 'asc' ? '▲' : '▼'}</span>}
            </div>
            {p.colType && <div className="th-type">{p.colType}</div>}
        </div>
    )
}

const fmt = (v: unknown) => {
    if (v === null || v === undefined) return null
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
}

export function ResultGrid({result}: {result: Result}) {
    const api = useRef<GridApi | null>(null)
    const {prefs, resolved, monoFont} = usePrefs()
    const theme = useMemo(() => makeTheme(resolved === 'dark', monoFont, prefs.fontSize, prefs.density === 'compact'), [resolved, monoFont, prefs.fontSize, prefs.density])

    const cols = useMemo<ColDef[]>(() => [
        {headerName: '#', valueGetter: p => (p.node?.rowIndex ?? 0) + 1, width: 56, pinned: 'left', sortable: false, resizable: false, cellClass: 'cell-rownum', suppressMovable: true},
        ...result.columns.map((c, i): ColDef => ({
            headerName: c.name,
            headerComponent: TypedHeader,
            headerComponentParams: {colType: c.type},
            valueGetter: p => p.data[i],
            valueFormatter: p => fmt(p.value) ?? '',
            cellRenderer: (p: {value: unknown}) => p.value === null || p.value === undefined
                ? <span className="cell-null">NULL</span>
                : <>{fmt(p.value)}</>,
            type: typeof result.rows[0]?.[i] === 'number' ? 'rightAligned' : undefined,
            cellClass: typeof result.rows[0]?.[i] === 'number' ? ['ag-right-aligned-cell', 'cell-num'] : undefined,
            minWidth: 80,
        })),
    ], [result])

    return (
        <AgGridReact
            theme={theme}
            columnDefs={cols}
            rowData={result.rows}
            defaultColDef={{sortable: true, resizable: true, filter: false}}
            onGridReady={e => { api.current = e.api }}
            enableCellTextSelection
            ensureDomOrder
            suppressFieldDotNotation
            animateRows={false}
        />
    )
}
