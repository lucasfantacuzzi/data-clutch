import {forwardRef, useImperativeHandle, useMemo, useRef} from 'react'
import {AgGridReact} from 'ag-grid-react'
import {AllCommunityModule, ColDef, GridApi, ModuleRegistry, colorSchemeDark, themeQuartz} from 'ag-grid-community'
import {Result} from './types'

ModuleRegistry.registerModules([AllCommunityModule])

const theme = themeQuartz.withPart(colorSchemeDark).withParams({
    backgroundColor: '#1e1f22',
    foregroundColor: '#bcbec4',
    headerBackgroundColor: '#2b2d30',
    headerTextColor: '#dfe1e5',
    oddRowBackgroundColor: '#212225',
    borderColor: '#393b40',
    rowHoverColor: '#2e436e55',
    selectedRowBackgroundColor: '#2e436e',
    fontSize: 12.5,
    rowHeight: 24,
    headerHeight: 28,
    fontFamily: 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
})

export interface GridHandle { exportCsv: () => void }

const fmt = (v: unknown) => {
    if (v === null || v === undefined) return null
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
}

export const ResultGrid = forwardRef<GridHandle, {result: Result}>(function ResultGrid({result}, ref) {
    const api = useRef<GridApi | null>(null)
    useImperativeHandle(ref, () => ({exportCsv: () => api.current?.exportDataAsCsv()}))

    const cols = useMemo<ColDef[]>(() => [
        {headerName: '#', valueGetter: p => (p.node?.rowIndex ?? 0) + 1, width: 56, pinned: 'left', sortable: false, resizable: false, cellStyle: {color: '#868a91'}, suppressMovable: true},
        ...result.columns.map((c, i): ColDef => ({
            headerName: c.name,
            headerTooltip: c.type,
            valueGetter: p => p.data[i],
            valueFormatter: p => fmt(p.value) ?? '',
            cellRenderer: (p: {value: unknown}) => p.value === null || p.value === undefined
                ? <span style={{color: '#6f737a', fontStyle: 'italic'}}>NULL</span>
                : <>{fmt(p.value)}</>,
            type: typeof result.rows[0]?.[i] === 'number' ? 'rightAligned' : undefined,
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
})
