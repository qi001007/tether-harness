// Lightweight practical spreadsheet editor for .xlsx workbooks and .csv/.tsv tables.
// Pure CSP-safe formula engine (no eval/Function) + interactive grid with AutoSum,
// drag fill-handle, multi-cell selection, TSV copy/paste, undo/redo, sort/filter & sheet tabs.

const FORMULA_NUMBER_RE = /^-?\d+(?:\.\d+)?$/
const DISPLAY_NUMBER_RE = /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/

export function colIndexToLetter(index) {
  let n = Math.floor(Number(index))
  if (!Number.isFinite(n) || n < 0) return ''
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

export function letterToColIndex(letters) {
  const clean = String(letters || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!clean) return -1
  let out = 0
  for (let i = 0; i < clean.length; i += 1) {
    out = out * 26 + (clean.charCodeAt(i) - 64)
  }
  return out - 1
}

export function parseCellRef(ref) {
  const match = /^(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)$/i.exec(String(ref || '').trim())
  if (!match) return null
  const col = letterToColIndex(match[2])
  const row = Number(match[4]) - 1
  if (col < 0 || row < 0) return null
  return { row, col, colAbs: match[1] === '$', rowAbs: match[3] === '$' }
}

export function shiftFormulaRefs(formula, dRow, dCol) {
  const text = String(formula == null ? '' : formula)
  if (!text.startsWith('=')) return text
  const parts = text.split(/("(?:[^"]|"")*")/g)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(^|[^A-Za-z0-9_$])(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)(?![A-Za-z0-9_(])/gi,
      (_full, prefix, cAbs, colStr, rAbs, rowStr) => {
        const colIdx = letterToColIndex(colStr)
        const rowIdx = Number(rowStr) - 1
        if (colIdx < 0 || rowIdx < 0) return prefix + cAbs + colStr + rAbs + rowStr
        const nextCol = cAbs ? colIdx : Math.max(0, colIdx + dCol)
        const nextRow = rAbs ? rowIdx : Math.max(0, rowIdx + dRow)
        return prefix + cAbs + colIndexToLetter(nextCol) + rAbs + (nextRow + 1)
      })
  }
  return parts.join('')
}

function toNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  const s = String(value == null ? '' : value).trim()
  if (!s) return null
  if (FORMULA_NUMBER_RE.test(s)) return Number(s)
  return null
}

function tokenizeFormula(expr) {
  const tokens = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (/\s/.test(ch)) { i += 1; continue }
    if (ch === '"') {
      let val = ''
      i += 1
      while (i < expr.length) {
        if (expr[i] === '"') {
          if (expr[i + 1] === '"') { val += '"'; i += 2; continue }
          i += 1
          break
        }
        val += expr[i]
        i += 1
      }
      tokens.push({ type: 'str', value: val })
      continue
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] || ''))) {
      let end = i
      while (end < expr.length && /[\d.]/.test(expr[end])) end += 1
      tokens.push({ type: 'num', value: Number(expr.slice(i, end)) })
      i = end
      continue
    }
    const two = expr.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
      tokens.push({ type: 'op', value: two })
      i += 2
      continue
    }
    if ('+-*/=<>(),:'.includes(ch)) {
      tokens.push({ type: ch === '(' || ch === ')' || ch === ',' || ch === ':' ? ch : 'op', value: ch })
      i += 1
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1
      while (end < expr.length && /[A-Za-z0-9_$]/.test(expr[end])) end += 1
      const word = expr.slice(i, end)
      i = end
      tokens.push({ type: 'ident', value: word })
      continue
    }
    throw new Error('#ERROR!')
  }
  return tokens
}

export function evalSpreadsheetFormula(raw, getCell, visited = new Set()) {
  if (raw == null) return ''
  const text = String(raw)
  if (!text.startsWith('=')) return text
  const expr = text.slice(1).trim()
  if (!expr) return ''

  let tokens
  try {
    tokens = tokenizeFormula(expr)
  } catch (err) {
    return err.message || '#ERROR!'
  }
  let pos = 0
  const peek = () => tokens[pos] || null
  const next = () => tokens[pos++] || null

  const evalCellAt = (row, col) => {
    const key = row + ':' + col
    if (visited.has(key)) throw new Error('#CYCLE!')
    const nextVisited = new Set(visited)
    nextVisited.add(key)
    const rawVal = getCell ? getCell(row, col) : ''
    if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
      const res = evalSpreadsheetFormula(rawVal, getCell, nextVisited)
      if (typeof res === 'string' && res.startsWith('#')) throw new Error(res)
      return res
    }
    return rawVal == null ? '' : rawVal
  }

  const collectArgItems = () => {
    const startRef = parseCellRef(peek() && peek().type === 'ident' ? peek().value : '')
    if (startRef && tokens[pos + 1] && tokens[pos + 1].type === ':' && tokens[pos + 2] && tokens[pos + 2].type === 'ident') {
      const endRef = parseCellRef(tokens[pos + 2].value)
      if (endRef) {
        pos += 3
        const out = []
        const rMin = Math.min(startRef.row, endRef.row)
        const rMax = Math.max(startRef.row, endRef.row)
        const cMin = Math.min(startRef.col, endRef.col)
        const cMax = Math.max(startRef.col, endRef.col)
        for (let r = rMin; r <= rMax; r += 1) {
          for (let c = cMin; c <= cMax; c += 1) out.push(evalCellAt(r, c))
        }
        return out
      }
    }
    return [parseCmp()]
  }

  const parsePrimary = () => {
    const tok = peek()
    if (!tok) throw new Error('#ERROR!')
    if (tok.type === 'num' || tok.type === 'str') { next(); return tok.value }
    if (tok.type === '(') {
      next()
      const val = parseCmp()
      if (!peek() || peek().type !== ')') throw new Error('#ERROR!')
      next()
      return val
    }
    if (tok.type === 'ident') {
      next()
      const upper = tok.value.toUpperCase()
      if (peek() && peek().type === '(') {
        next()
        const rawArgs = []
        const flatArgs = []
        if (peek() && peek().type !== ')') {
          while (true) {
            const items = collectArgItems()
            rawArgs.push(items.length === 1 ? items[0] : items)
            flatArgs.push(...items)
            if (peek() && peek().type === ',') { next(); continue }
            break
          }
        }
        if (!peek() || peek().type !== ')') throw new Error('#ERROR!')
        next()
        const nums = () => flatArgs.map(toNumeric).filter((v) => v !== null)
        if (upper === 'SUM') return nums().reduce((acc, v) => acc + v, 0)
        if (upper === 'AVERAGE' || upper === 'AVG') {
          const list = nums()
          if (!list.length) throw new Error('#DIV/0!')
          return list.reduce((acc, v) => acc + v, 0) / list.length
        }
        if (upper === 'COUNT') return nums().length
        if (upper === 'COUNTA') return flatArgs.filter((v) => String(v == null ? '' : v).trim() !== '').length
        if (upper === 'MIN') {
          const list = nums()
          return list.length ? Math.min(...list) : 0
        }
        if (upper === 'MAX') {
          const list = nums()
          return list.length ? Math.max(...list) : 0
        }
        if (upper === 'ABS') {
          const n = toNumeric(rawArgs[0])
          if (n === null) throw new Error('#ERROR!')
          return Math.abs(n)
        }
        if (upper === 'ROUND') {
          const n = toNumeric(rawArgs[0])
          const digits = rawArgs.length > 1 ? Number(toNumeric(rawArgs[1]) || 0) : 0
          if (n === null || !Number.isFinite(digits)) throw new Error('#ERROR!')
          const factor = 10 ** Math.trunc(digits)
          return Math.round(n * factor) / factor
        }
        if (upper === 'IF') {
          const cond = rawArgs[0]
          const truthy = typeof cond === 'boolean' ? cond : (toNumeric(cond) !== null ? toNumeric(cond) !== 0 : String(cond || '').toUpperCase() === 'TRUE')
          return truthy ? (rawArgs[1] ?? '') : (rawArgs[2] ?? '')
        }
        throw new Error('#NAME?')
      }
      if (upper === 'TRUE') return true
      if (upper === 'FALSE') return false
      const ref = parseCellRef(tok.value)
      if (ref) return evalCellAt(ref.row, ref.col)
      throw new Error('#NAME?')
    }
    throw new Error('#ERROR!')
  }

  const parseUnary = () => {
    const tok = peek()
    if (tok && tok.type === 'op' && (tok.value === '-' || tok.value === '+')) {
      next()
      const val = parseUnary()
      const num = val === '' ? 0 : toNumeric(val)
      if (num === null) throw new Error('#ERROR!')
      return tok.value === '-' ? -num : num
    }
    return parsePrimary()
  }

  const parseMul = () => {
    let left = parseUnary()
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value
      const right = parseUnary()
      const a = left === '' ? 0 : toNumeric(left)
      const b = right === '' ? 0 : toNumeric(right)
      if (a === null || b === null) throw new Error('#ERROR!')
      if (op === '/') {
        if (b === 0) throw new Error('#DIV/0!')
        left = a / b
      } else {
        left = a * b
      }
    }
    return left
  }

  const parseAdd = () => {
    let left = parseMul()
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value
      const right = parseMul()
      const a = left === '' ? 0 : toNumeric(left)
      const b = right === '' ? 0 : toNumeric(right)
      if (a === null || b === null) throw new Error('#ERROR!')
      left = op === '+' ? a + b : a - b
    }
    return left
  }

  const parseCmp = () => {
    let left = parseAdd()
    while (peek() && peek().type === 'op' && ['=', '<', '>', '<=', '>=', '<>', '!='].includes(peek().value)) {
      const op = next().value
      const right = parseAdd()
      const aNum = toNumeric(left)
      const bNum = toNumeric(right)
      const cmp = (aNum !== null && bNum !== null)
        ? aNum - bNum
        : String(left ?? '').localeCompare(String(right ?? ''))
      if (op === '=') left = cmp === 0
      else if (op === '<>' || op === '!=') left = cmp !== 0
      else if (op === '<') left = cmp < 0
      else if (op === '>') left = cmp > 0
      else if (op === '<=') left = cmp <= 0
      else if (op === '>=') left = cmp >= 0
    }
    return left
  }

  try {
    const value = parseCmp()
    if (pos !== tokens.length) return '#ERROR!'
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return '#ERROR!'
      return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)))
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    return String(value == null ? '' : value)
  } catch (err) {
    return err.message || '#ERROR!'
  }
}

export function parseTsvClipboard(text) {
  const source = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (!source) return [['']]
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; continue }
        inQuotes = false; continue
      }
      cell += ch; continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; continue }
    if (ch === '\t') { row.push(cell); cell = ''; continue }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows
}

export function serializeTsvClipboard(rows) {
  return (rows || []).map((row) => (row || []).map((cell) => {
    const text = String(cell == null ? '' : cell)
    return /[\t\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
  }).join('\t')).join('\n')
}

export function fillRangeValues(sourceRows, targetRowCount, targetColCount, direction = 'down') {
  const srcR = Math.max(1, sourceRows.length)
  const srcC = Math.max(1, ...sourceRows.map((r) => (r ? r.length : 0)))
  const out = Array.from({ length: targetRowCount }, () => new Array(targetColCount).fill(''))
  const vertical = direction === 'down' || direction === 'up'

  if (vertical) {
    for (let c = 0; c < targetColCount; c += 1) {
      const colSrc = Array.from({ length: srcR }, (_, r) => String((sourceRows[r] && sourceRows[r][c % srcC]) ?? ''))
      const nums = colSrc.map((v) => (FORMULA_NUMBER_RE.test(v.trim()) ? Number(v.trim()) : null))
      let step = null
      if (srcR >= 2 && nums.every((v) => v !== null)) {
        const diff = nums[1] - nums[0]
        if (nums.every((v, idx) => idx === 0 || Math.abs((v - nums[idx - 1]) - diff) < 1e-9)) step = diff
      }
      for (let r = 0; r < targetRowCount; r += 1) {
        if (direction === 'down') {
          if (r < srcR) out[r][c] = colSrc[r]
          else if (step !== null) out[r][c] = String(Number((nums[srcR - 1] + step * (r - srcR + 1)).toPrecision(12)))
          else {
            const baseIdx = r % srcR
            const base = colSrc[baseIdx]
            out[r][c] = base.startsWith('=') ? shiftFormulaRefs(base, r - baseIdx, 0) : base
          }
        } else {
          const offsetFromBottom = targetRowCount - 1 - r
          if (offsetFromBottom < srcR) out[r][c] = colSrc[srcR - 1 - offsetFromBottom]
          else if (step !== null) out[r][c] = String(Number((nums[0] - step * (offsetFromBottom - srcR + 1)).toPrecision(12)))
          else {
            const baseIdx = (srcR - 1 - (offsetFromBottom % srcR)) % srcR
            const base = colSrc[baseIdx]
            out[r][c] = base.startsWith('=') ? shiftFormulaRefs(base, -(offsetFromBottom - (srcR - 1 - baseIdx)), 0) : base
          }
        }
      }
    }
  } else {
    for (let r = 0; r < targetRowCount; r += 1) {
      const rowSrc = Array.from({ length: srcC }, (_, c) => String((sourceRows[r % srcR] && sourceRows[r % srcR][c]) ?? ''))
      const nums = rowSrc.map((v) => (FORMULA_NUMBER_RE.test(v.trim()) ? Number(v.trim()) : null))
      let step = null
      if (srcC >= 2 && nums.every((v) => v !== null)) {
        const diff = nums[1] - nums[0]
        if (nums.every((v, idx) => idx === 0 || Math.abs((v - nums[idx - 1]) - diff) < 1e-9)) step = diff
      }
      for (let c = 0; c < targetColCount; c += 1) {
        if (direction === 'right') {
          if (c < srcC) out[r][c] = rowSrc[c]
          else if (step !== null) out[r][c] = String(Number((nums[srcC - 1] + step * (c - srcC + 1)).toPrecision(12)))
          else {
            const baseIdx = c % srcC
            const base = rowSrc[baseIdx]
            out[r][c] = base.startsWith('=') ? shiftFormulaRefs(base, 0, c - baseIdx) : base
          }
        } else {
          const offsetFromRight = targetColCount - 1 - c
          if (offsetFromRight < srcC) out[r][c] = rowSrc[srcC - 1 - offsetFromRight]
          else if (step !== null) out[r][c] = String(Number((nums[0] - step * (offsetFromRight - srcC + 1)).toPrecision(12)))
          else {
            const baseIdx = (srcC - 1 - (offsetFromRight % srcC)) % srcC
            const base = rowSrc[baseIdx]
            out[r][c] = base.startsWith('=') ? shiftFormulaRefs(base, 0, -(offsetFromRight - (srcC - 1 - baseIdx))) : base
          }
        }
      }
    }
  }
  return out
}

export function computeSelectionStats(rows, range, resolveValue) {
  if (!range) return { count: 0, numericCount: 0, sum: 0, avg: 0, min: null, max: null }
  const r0 = Math.min(range.r0, range.r1)
  const r1 = Math.max(range.r0, range.r1)
  const c0 = Math.min(range.c0, range.c1)
  const c1 = Math.max(range.c0, range.c1)
  let count = 0
  let numericCount = 0
  let sum = 0
  let min = null
  let max = null
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const disp = resolveValue ? resolveValue(r, c) : ((rows[r] && rows[r][c]) ?? '')
      const text = String(disp == null ? '' : disp).trim()
      if (!text) continue
      count += 1
      if (!text.startsWith('#') && FORMULA_NUMBER_RE.test(text)) {
        const n = Number(text)
        numericCount += 1
        sum += n
        if (min === null || n < min) min = n
        if (max === null || n > max) max = n
      }
    }
  }
  return {
    count,
    numericCount,
    sum,
    avg: numericCount ? sum / numericCount : 0,
    min,
    max
  }
}

export function inferAutoSumPlacements(rows, sel, resolveValue) {
  if (!sel) return []
  const r0 = Math.min(sel.r0, sel.r1)
  const r1 = Math.max(sel.r0, sel.r1)
  const c0 = Math.min(sel.c0, sel.c1)
  const c1 = Math.max(sel.c0, sel.c1)
  const isNum = (r, c) => {
    const val = String((resolveValue ? resolveValue(r, c) : ((rows[r] && rows[r][c]) ?? '')) || '').trim()
    return val !== '' && FORMULA_NUMBER_RE.test(val)
  }
  if (r0 === r1 && c0 === c1) {
    let top = r0 - 1
    while (top >= 0 && isNum(top, c0)) top -= 1
    top += 1
    if (top <= r0 - 1) {
      const col = colIndexToLetter(c0)
      return [{ row: r0, col: c0, formula: '=SUM(' + col + (top + 1) + ':' + col + r0 + ')' }]
    }
    let left = c0 - 1
    while (left >= 0 && isNum(r0, left)) left -= 1
    left += 1
    if (left <= c0 - 1) {
      return [{ row: r0, col: c0, formula: '=SUM(' + colIndexToLetter(left) + (r0 + 1) + ':' + colIndexToLetter(c0 - 1) + (r0 + 1) + ')' }]
    }
    return [{ row: r0, col: c0, formula: '=SUM()' }]
  }
  if (r1 > r0) {
    const targetRow = r1 + 1
    const placements = []
    for (let c = c0; c <= c1; c += 1) {
      const col = colIndexToLetter(c)
      placements.push({ row: targetRow, col: c, formula: '=SUM(' + col + (r0 + 1) + ':' + col + (r1 + 1) + ')' })
    }
    return placements
  }
  return [{
    row: r0,
    col: c1 + 1,
    formula: '=SUM(' + colIndexToLetter(c0) + (r0 + 1) + ':' + colIndexToLetter(c1) + (r0 + 1) + ')'
  }]
}

function normalizeSheetGrid(sheetRows, minRows = 12, minCols = 8) {
  const rowCount = Math.max(minRows, (sheetRows || []).length)
  const colCount = Math.max(minCols, ...(sheetRows || []).map((r) => (r ? r.length : 0)))
  const grid = []
  for (let r = 0; r < rowCount; r += 1) {
    const src = (sheetRows && sheetRows[r]) || []
    const row = []
    for (let c = 0; c < colCount; c += 1) row.push(src[c] == null ? '' : String(src[c]))
    grid.push(row)
  }
  return grid
}

export function trimWorkbookForSave(workbook) {
  return {
    ...workbook,
    sheets: (workbook.sheets || []).map((sheet) => {
      const rows = (sheet.rows || []).map((row) => {
        const copy = [...row]
        while (copy.length && copy[copy.length - 1] === '') copy.pop()
        return copy
      })
      while (rows.length && !rows[rows.length - 1].length) rows.pop()
      return { name: sheet.name, rows }
    })
  }
}

export function createSpreadsheetEditor(React) {
  const h = React.createElement

  return function SpreadsheetEditor({
    colors,
    Glyph,
    workbook,
    readOnly = false,
    readOnlyReason = '',
    dirty = false,
    busy = false,
    singleSheet = false,
    onChange,
    onSave
  }) {
    const C = colors || {}
    const [sheetIndex, setSheetIndex] = React.useState(0)
    const [sel, setSel] = React.useState({ r0: 0, c0: 0, r1: 0, c1: 0 })
    const [editing, setEditing] = React.useState(null)
    const [filterText, setFilterText] = React.useState('')
    const [renamingSheet, setRenamingSheet] = React.useState(null)
    const [historyPast, setHistoryPast] = React.useState([])
    const [historyFuture, setHistoryFuture] = React.useState([])
    const [fillPreview, setFillPreview] = React.useState(null)
    const rootRef = React.useRef(null)
    const editInputRef = React.useRef(null)

    const sheets = (workbook && Array.isArray(workbook.sheets) && workbook.sheets.length)
      ? workbook.sheets
      : [{ name: 'Sheet1', rows: [] }]
    const safeSheetIdx = Math.min(sheetIndex, sheets.length - 1)
    const currentSheet = sheets[safeSheetIdx]
    const grid = React.useMemo(() => normalizeSheetGrid(currentSheet.rows), [currentSheet])
    const rowCount = grid.length
    const colCount = grid[0] ? grid[0].length : 8

    const workbookRef = React.useRef(workbook)
    workbookRef.current = workbook
    const onSaveRef = React.useRef(onSave)
    onSaveRef.current = onSave

    React.useEffect(() => {
      setSheetIndex(0)
      setSel({ r0: 0, c0: 0, r1: 0, c1: 0 })
      setEditing(null)
      setFilterText('')
      setHistoryPast([])
      setHistoryFuture([])
    }, [workbook && workbook.sheets && workbook.sheets[0] && workbook.sheets[0].name, readOnly])

    const getRaw = React.useCallback((r, c) => (grid[r] && grid[r][c]) ?? '', [grid])
    const evaluatedGrid = React.useMemo(() => {
      const cache = new Map()
      const readVal = (r, c) => {
        if (r < 0 || c < 0 || r >= rowCount) return ''
        const key = r + ':' + c
        if (cache.has(key)) return cache.get(key)
        const raw = getRaw(r, c)
        if (typeof raw === 'string' && raw.startsWith('=')) {
          const val = evalSpreadsheetFormula(raw, getRaw)
          cache.set(key, val)
          return val
        }
        cache.set(key, raw)
        return raw
      }
      return readVal
    }, [grid, getRaw, rowCount])

    const commitWorkbook = React.useCallback((nextSheets, pushHistory = true) => {
      if (readOnly) return
      const current = workbookRef.current || { format: 'xlsx', sheets }
      if (pushHistory) {
        setHistoryPast((prev) => [...prev.slice(-49), current])
        setHistoryFuture([])
      }
      const nextWorkbook = { ...current, sheets: nextSheets }
      if (onChange) onChange(nextWorkbook)
    }, [readOnly, sheets, onChange])

    const updateCurrentGrid = React.useCallback((mutator, pushHistory = true) => {
      if (readOnly) return
      const draftGrid = grid.map((row) => [...row])
      mutator(draftGrid)
      const nextSheets = sheets.map((s, idx) => idx === safeSheetIdx ? { ...s, rows: draftGrid } : s)
      commitWorkbook(nextSheets, pushHistory)
    }, [readOnly, grid, sheets, safeSheetIdx, commitWorkbook])

    const undo = React.useCallback(() => {
      if (readOnly || !historyPast.length) return
      const prev = historyPast[historyPast.length - 1]
      setHistoryPast((list) => list.slice(0, -1))
      setHistoryFuture((list) => [workbookRef.current, ...list.slice(0, 49)])
      if (onChange) onChange(prev)
    }, [readOnly, historyPast, onChange])

    const redo = React.useCallback(() => {
      if (readOnly || !historyFuture.length) return
      const next = historyFuture[0]
      setHistoryFuture((list) => list.slice(1))
      setHistoryPast((list) => [...list.slice(-49), workbookRef.current])
      if (onChange) onChange(next)
    }, [readOnly, historyFuture, onChange])

    const normSel = React.useMemo(() => ({
      r0: Math.min(sel.r0, sel.r1),
      r1: Math.max(sel.r0, sel.r1),
      c0: Math.min(sel.c0, sel.c1),
      c1: Math.max(sel.c0, sel.c1)
    }), [sel])

    const visibleRowIndices = React.useMemo(() => {
      const term = filterText.trim().toLowerCase()
      const indices = []
      for (let r = 0; r < rowCount; r += 1) {
        if (!term) { indices.push(r); continue }
        const matched = grid[r].some((cell, c) => (
          String(cell || '').toLowerCase().includes(term)
          || String(evaluatedGrid(r, c) || '').toLowerCase().includes(term)
        ))
        if (matched) indices.push(r)
      }
      return indices
    }, [filterText, rowCount, grid, evaluatedGrid])

    const stats = React.useMemo(() => computeSelectionStats(grid, normSel, evaluatedGrid), [grid, normSel, evaluatedGrid])
    const activeRaw = getRaw(sel.r0, sel.c0)
    const activeRefLabel = colIndexToLetter(sel.c0) + (sel.r0 + 1)

    const commitEdit = React.useCallback((moveDr = 0, moveDc = 0) => {
      if (!editing) return
      const { row, col, value } = editing
      setEditing(null)
      if (!readOnly && getRaw(row, col) !== value) {
        updateCurrentGrid((draftGrid) => {
          draftGrid[row][col] = value
        })
      }
      if (moveDr || moveDc) {
        const nextR = Math.max(0, Math.min(rowCount - 1, row + moveDr))
        const nextC = Math.max(0, Math.min(colCount - 1, col + moveDc))
        setSel({ r0: nextR, c0: nextC, r1: nextR, c1: nextC })
        if (rootRef.current) rootRef.current.focus()
      }
    }, [editing, readOnly, getRaw, updateCurrentGrid, rowCount, colCount])

    const handleAutoSum = () => {
      if (readOnly) return
      const placements = inferAutoSumPlacements(grid, normSel, evaluatedGrid)
      if (!placements.length) return
      updateCurrentGrid((draftGrid) => {
        for (const item of placements) {
          while (draftGrid.length <= item.row) draftGrid.push(new Array(colCount).fill(''))
          for (const r of draftGrid) {
            while (r.length <= item.col) r.push('')
          }
          draftGrid[item.row][item.col] = item.formula
        }
      })
      const first = placements[0]
      setSel({ r0: first.row, c0: first.col, r1: first.row, c1: first.col })
    }

    const sortActiveColumn = (dir) => {
      if (readOnly) return
      const col = sel.c0
      updateCurrentGrid((draftGrid) => {
        let lastNonEmpty = draftGrid.length - 1
        while (lastNonEmpty > 0 && draftGrid[lastNonEmpty].every((v) => v === '')) lastNonEmpty -= 1
        if (lastNonEmpty < 1) return
        const head = draftGrid[0]
        const body = draftGrid.slice(1, lastNonEmpty + 1)
        const tail = draftGrid.slice(lastNonEmpty + 1)
        body.sort((a, b) => {
          const av = String(a[col] || '').trim()
          const bv = String(b[col] || '').trim()
          if (!av && !bv) return 0
          if (!av) return 1
          if (!bv) return -1
          const an = FORMULA_NUMBER_RE.test(av) ? Number(av) : null
          const bn = FORMULA_NUMBER_RE.test(bv) ? Number(bv) : null
          const cmp = (an !== null && bn !== null) ? an - bn : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
          return dir === 'asc' ? cmp : -cmp
        })
        const next = [head, ...body, ...tail]
        for (let i = 0; i < draftGrid.length; i += 1) draftGrid[i] = next[i]
      })
    }

    const insertRow = () => {
      if (readOnly) return
      updateCurrentGrid((draftGrid) => {
        draftGrid.splice(normSel.r0, 0, new Array(colCount).fill(''))
      })
    }

    const deleteRow = () => {
      if (readOnly || rowCount <= 1) return
      updateCurrentGrid((draftGrid) => {
        draftGrid.splice(normSel.r0, Math.min(normSel.r1 - normSel.r0 + 1, draftGrid.length - 1))
      })
      setSel({ r0: Math.max(0, normSel.r0 - 1), c0: normSel.c0, r1: Math.max(0, normSel.r0 - 1), c1: normSel.c0 })
    }

    const insertCol = () => {
      if (readOnly) return
      updateCurrentGrid((draftGrid) => {
        for (const r of draftGrid) r.splice(normSel.c0, 0, '')
      })
    }

    const deleteCol = () => {
      if (readOnly || colCount <= 1) return
      const delCount = Math.min(normSel.c1 - normSel.c0 + 1, colCount - 1)
      updateCurrentGrid((draftGrid) => {
        for (const r of draftGrid) r.splice(normSel.c0, delCount)
      })
      setSel({ r0: normSel.r0, c0: Math.max(0, normSel.c0 - 1), r1: normSel.r0, c1: Math.max(0, normSel.c0 - 1) })
    }

    const copySelection = async () => {
      const slice = []
      for (let r = normSel.r0; r <= normSel.r1; r += 1) {
        const row = []
        for (let c = normSel.c0; c <= normSel.c1; c += 1) row.push(getRaw(r, c))
        slice.push(row)
      }
      const text = serializeTsvClipboard(slice)
      try { await navigator.clipboard.writeText(text) } catch (_) { /* clipboard blocked */ }
    }

    const pasteFromText = (text) => {
      if (readOnly || typeof text !== 'string') return
      const parsed = parseTsvClipboard(text)
      updateCurrentGrid((draftGrid) => {
        for (let dr = 0; dr < parsed.length; dr += 1) {
          const r = normSel.r0 + dr
          while (draftGrid.length <= r) draftGrid.push(new Array(colCount).fill(''))
          for (let dc = 0; dc < parsed[dr].length; dc += 1) {
            const c = normSel.c0 + dc
            for (const row of draftGrid) { while (row.length <= c) row.push('') }
            draftGrid[r][c] = parsed[dr][dc]
          }
        }
      })
      setSel({
        r0: normSel.r0,
        c0: normSel.c0,
        r1: normSel.r0 + parsed.length - 1,
        c1: normSel.c0 + Math.max(1, ...parsed.map((r) => r.length)) - 1
      })
    }

    const startCellDrag = (startR, startC, event) => {
      if (event.button !== 0) return
      if (editing && (editing.row !== startR || editing.col !== startC)) commitEdit(0, 0)
      if (event.shiftKey) {
        setSel((cur) => ({ r0: cur.r0, c0: cur.c0, r1: startR, c1: startC }))
        return
      }
      setSel({ r0: startR, c0: startC, r1: startR, c1: startC })
      const move = (ev) => {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)
        const cellEl = target && target.closest ? target.closest('[data-cell-rc]') : null
        if (!cellEl) return
        const [rStr, cStr] = String(cellEl.getAttribute('data-cell-rc') || '').split(':')
        const r = Number(rStr); const c = Number(cStr)
        if (Number.isInteger(r) && Number.isInteger(c)) setSel((cur) => ({ ...cur, r1: r, c1: c }))
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    const startFillHandleDrag = (event) => {
      if (readOnly || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      let currentTarget = null
      const move = (ev) => {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)
        const cellEl = target && target.closest ? target.closest('[data-cell-rc]') : null
        if (!cellEl) return
        const [rStr, cStr] = String(cellEl.getAttribute('data-cell-rc') || '').split(':')
        const r = Number(rStr); const c = Number(cStr)
        if (!Number.isInteger(r) || !Number.isInteger(c)) return
        if (r > normSel.r1) currentTarget = { direction: 'down', r0: normSel.r0, r1: r, c0: normSel.c0, c1: normSel.c1 }
        else if (r < normSel.r0) currentTarget = { direction: 'up', r0: r, r1: normSel.r1, c0: normSel.c0, c1: normSel.c1 }
        else if (c > normSel.c1) currentTarget = { direction: 'right', r0: normSel.r0, r1: normSel.r1, c0: normSel.c0, c1: c }
        else if (c < normSel.c0) currentTarget = { direction: 'left', r0: normSel.r0, r1: normSel.r1, c0: c, c1: normSel.c1 }
        else currentTarget = null
        setFillPreview(currentTarget)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setFillPreview(null)
        if (!currentTarget) return
        const srcRows = []
        for (let r = normSel.r0; r <= normSel.r1; r += 1) {
          const line = []
          for (let c = normSel.c0; c <= normSel.c1; c += 1) line.push(getRaw(r, c))
          srcRows.push(line)
        }
        const filled = fillRangeValues(
          srcRows,
          currentTarget.r1 - currentTarget.r0 + 1,
          currentTarget.c1 - currentTarget.c0 + 1,
          currentTarget.direction
        )
        updateCurrentGrid((draftGrid) => {
          for (let dr = 0; dr < filled.length; dr += 1) {
            for (let dc = 0; dc < filled[dr].length; dc += 1) {
              draftGrid[currentTarget.r0 + dr][currentTarget.c0 + dc] = filled[dr][dc]
            }
          }
        })
        setSel({ r0: currentTarget.r0, c0: currentTarget.c0, r1: currentTarget.r1, c1: currentTarget.c1 })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    const handleGridKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        if (editing) commitEdit(0, 0)
        if (!readOnly && onSaveRef.current) onSaveRef.current(trimWorkbookForSave(workbookRef.current))
        return
      }
      if (editing) return
      const targetTag = event.target && event.target.tagName
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return

      const mod = event.ctrlKey || event.metaKey
      if (mod && String(event.key).toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
      if (mod && String(event.key).toLowerCase() === 'y') { event.preventDefault(); redo(); return }
      if (mod && String(event.key).toLowerCase() === 'c') { event.preventDefault(); void copySelection(); return }
      if (mod && String(event.key).toLowerCase() === 'v') {
        event.preventDefault()
        if (navigator.clipboard && navigator.clipboard.readText) {
          void navigator.clipboard.readText().then(pasteFromText).catch(() => {})
        }
        return
      }
      if (event.altKey && event.key === '=') { event.preventDefault(); handleAutoSum(); return }

      const drMap = { ArrowUp: -1, ArrowDown: 1 }
      const dcMap = { ArrowLeft: -1, ArrowRight: 1 }
      if (drMap[event.key] || dcMap[event.key]) {
        event.preventDefault()
        const dr = drMap[event.key] || 0
        const dc = dcMap[event.key] || 0
        if (event.shiftKey) {
          setSel((cur) => ({
            ...cur,
            r1: Math.max(0, Math.min(rowCount - 1, cur.r1 + dr)),
            c1: Math.max(0, Math.min(colCount - 1, cur.c1 + dc))
          }))
        } else {
          const nextR = Math.max(0, Math.min(rowCount - 1, sel.r0 + dr))
          const nextC = Math.max(0, Math.min(colCount - 1, sel.c0 + dc))
          setSel({ r0: nextR, c0: nextC, r1: nextR, c1: nextC })
        }
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const nextC = Math.max(0, Math.min(colCount - 1, sel.c0 + (event.shiftKey ? -1 : 1)))
        setSel({ r0: sel.r0, c0: nextC, r1: sel.r0, c1: nextC })
        return
      }
      if (!readOnly && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault()
        updateCurrentGrid((draftGrid) => {
          for (let r = normSel.r0; r <= normSel.r1; r += 1) {
            for (let c = normSel.c0; c <= normSel.c1; c += 1) draftGrid[r][c] = ''
          }
        })
        return
      }
      if (!readOnly && (event.key === 'F2' || event.key === 'Enter')) {
        event.preventDefault()
        setEditing({ row: sel.r0, col: sel.c0, value: getRaw(sel.r0, sel.c0) })
        return
      }
      if (!readOnly && !mod && !event.altKey && event.key.length === 1) {
        event.preventDefault()
        setEditing({ row: sel.r0, col: sel.c0, value: event.key })
      }
    }

    const addSheet = () => {
      if (readOnly || singleSheet || sheets.length >= 20) return
      let n = sheets.length + 1
      while (sheets.some((s) => s.name.toLowerCase() === ('sheet' + n))) n += 1
      const next = [...sheets, { name: 'Sheet' + n, rows: [] }]
      commitWorkbook(next)
      setSheetIndex(next.length - 1)
      setSel({ r0: 0, c0: 0, r1: 0, c1: 0 })
    }

    const deleteSheet = (idx) => {
      if (readOnly || singleSheet || sheets.length <= 1) return
      const next = sheets.filter((_, i) => i !== idx)
      commitWorkbook(next)
      setSheetIndex(Math.max(0, idx - 1))
      setSel({ r0: 0, c0: 0, r1: 0, c1: 0 })
    }

    const commitRenameSheet = () => {
      if (!renamingSheet) return
      const name = renamingSheet.value.trim().slice(0, 31)
      const idx = renamingSheet.index
      setRenamingSheet(null)
      if (!name || /[:\\/?*[\]]/.test(name)) return
      if (sheets.some((s, i) => i !== idx && s.name.toLowerCase() === name.toLowerCase())) return
      commitWorkbook(sheets.map((s, i) => i === idx ? { ...s, name } : s))
    }

    const tbBtn = (label, onClick, disabled, content) => h('button', {
      type: 'button',
      title: label,
      'aria-label': label,
      disabled,
      onClick,
      className: 'tether-hover tether-press',
      style: {
        height: 26, minWidth: 26, padding: '0 7px', border: 0, borderRadius: 6,
        background: 'transparent', color: disabled ? C.mute : C.ink, fontSize: 12,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.42 : 1, flex: '0 0 auto'
      }
    }, content)

    const accent = 'var(--tether-accent, var(--dsw-alias-state-business-primary, #1570ef))'
    const selBg = 'color-mix(in srgb, ' + accent + ' 11%, transparent)'
    const fillBg = 'color-mix(in srgb, ' + accent + ' 6%, transparent)'

    return h('div', {
      ref: rootRef,
      tabIndex: 0,
      onKeyDown: handleGridKeyDown,
      onPaste: (event) => {
        const tag = event.target && event.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || readOnly) return
        const text = event.clipboardData && event.clipboardData.getData('text/plain')
        if (text) { event.preventDefault(); pasteFromText(text) }
      },
      style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none', background: C.bg }
    },
      // Compact formula + quick-action bar
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
          borderBottom: '1px solid ' + (C.line || 'rgba(0,0,0,0.08)'),
          background: C.panel, flex: '0 0 auto', flexWrap: 'wrap'
        }
      },
        !readOnly ? h(React.Fragment, null,
          tbBtn('撤销 (Ctrl+Z)', undo, !historyPast.length, '↶'),
          tbBtn('重做 (Ctrl+Y)', redo, !historyFuture.length, '↷'),
          h('span', { style: { width: 1, height: 14, background: C.line } }),
          tbBtn('快速求和 (Alt+=)', handleAutoSum, false, h('span', { style: { fontWeight: 600 } }, 'Σ 求和')),
          tbBtn('当前列升序', () => sortActiveColumn('asc'), false, 'A↓'),
          tbBtn('当前列降序', () => sortActiveColumn('desc'), false, 'Z↓'),
          h('span', { style: { width: 1, height: 14, background: C.line } }),
          tbBtn('插入行', insertRow, false, '+行'),
          tbBtn('删除行', deleteRow, rowCount <= 1, '-行'),
          tbBtn('插入列', insertCol, false, '+列'),
          tbBtn('删除列', deleteCol, colCount <= 1, '-列'),
          h('span', { style: { width: 1, height: 14, background: C.line } })
        ) : null,
        h('span', {
          className: 'tether-num',
          style: {
            minWidth: 38, height: 26, padding: '0 7px', borderRadius: 5,
            background: C.soft, color: C.ink, fontSize: 11.5, fontWeight: 600,
            display: 'grid', placeItems: 'center', flex: '0 0 auto'
          }
        }, activeRefLabel),
        h('span', { style: { color: C.mute, fontSize: 11.5, fontStyle: 'italic', flex: '0 0 auto' } }, 'fx'),
        h('input', {
          value: editing && editing.row === sel.r0 && editing.col === sel.c0 ? editing.value : activeRaw,
          readOnly,
          'aria-label': '编辑栏公式或内容',
          placeholder: readOnly ? '只读单元格' : '输入数值或公式（如 =SUM(A1:A5)）',
          onChange: (ev) => {
            if (readOnly) return
            const val = ev.target.value
            updateCurrentGrid((draftGrid) => { draftGrid[sel.r0][sel.c0] = val }, false)
          },
          onKeyDown: (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault()
              const nextR = Math.min(rowCount - 1, sel.r0 + 1)
              setSel({ r0: nextR, c0: sel.c0, r1: nextR, c1: sel.c0 })
              if (rootRef.current) rootRef.current.focus()
            } else if (ev.key === 'Escape' && rootRef.current) {
              rootRef.current.focus()
            }
          },
          style: {
            flex: '1 1 180px', minWidth: 120, height: 26, padding: '0 8px',
            borderRadius: 5, border: '1px solid ' + (C.line || 'rgba(0,0,0,0.08)'),
            background: C.bg, color: C.ink, fontSize: 12, fontFamily: 'Consolas, monospace', outline: 'none'
          }
        }),
        h('input', {
          value: filterText,
          'aria-label': '筛选行',
          placeholder: '筛选…',
          onChange: (ev) => setFilterText(ev.target.value),
          onKeyDown: (ev) => { if (ev.key === 'Escape') { setFilterText(''); if (rootRef.current) rootRef.current.focus() } },
          style: {
            width: 124, height: 26, padding: '0 8px', borderRadius: 5,
            border: '1px solid ' + (C.line || 'rgba(0,0,0,0.08)'),
            background: C.bg, color: C.ink, fontSize: 12, outline: 'none', flex: '0 0 auto'
          }
        }),
        !readOnly && onSave ? h('button', {
          type: 'button',
          disabled: busy || !dirty,
          onClick: () => onSave(trimWorkbookForSave(workbookRef.current)),
          className: 'tether-hover tether-press',
          style: {
            height: 26, padding: '0 10px', border: 0, borderRadius: 6,
            background: dirty ? accent : C.soft,
            color: dirty ? '#ffffff' : C.mute,
            fontSize: 12, cursor: (busy || !dirty) ? 'default' : 'pointer',
            opacity: (busy || !dirty) ? 0.6 : 1, flex: '0 0 auto',
            display: 'inline-flex', alignItems: 'center', gap: 5
          }
        }, Glyph ? h(Glyph, { name: 'save', size: 13 }) : null, busy ? '保存中…' : '保存') : null
      ),
      // Read-only lock notice if protected (macros / charts / permissions)
      readOnlyReason ? h('div', {
        style: {
          padding: '5px 12px', fontSize: 11.5, color: C.amber || '#b54708',
          background: 'color-mix(in srgb, ' + (C.amber || '#b54708') + ' 10%, transparent)',
          borderBottom: '1px solid ' + (C.line || 'rgba(0,0,0,0.08)'),
          flex: '0 0 auto'
        }
      }, readOnlyReason) : null,
      // Grid viewport
      h('div', { className: 'tether-scroll tether-table-scroll', style: { position: 'relative' } },
        h('table', {
          className: 'tether-table',
          role: 'grid',
          'aria-label': '电子表格',
          style: { tableLayout: 'fixed', userSelect: 'none' }
        },
          h('thead', null,
            h('tr', null,
              h('th', { scope: 'col', style: { width: 42, minWidth: 42, textAlign: 'center', position: 'sticky', left: 0, zIndex: 4 } }, ''),
              Array.from({ length: colCount }, (_, c) => {
                const colActive = c >= normSel.c0 && c <= normSel.c1
                return h('th', {
                  key: c, scope: 'col',
                  onClick: () => setSel({ r0: 0, c0: c, r1: rowCount - 1, c1: c }),
                  style: {
                    width: 112, minWidth: 92, textAlign: 'center', cursor: 'pointer',
                    color: colActive ? accent : C.mute,
                    background: colActive ? 'color-mix(in srgb, ' + accent + ' 10%, ' + C.panel + ')' : undefined
                  }
                }, colIndexToLetter(c))
              })
            )
          ),
          h('tbody', null,
            visibleRowIndices.map((r) => h('tr', { key: r },
              h('td', {
                onClick: () => setSel({ r0: r, c0: 0, r1: r, c1: colCount - 1 }),
                className: 'tether-num',
                style: {
                  width: 42, textAlign: 'center', color: (r >= normSel.r0 && r <= normSel.r1) ? accent : C.mute,
                  background: 'var(--tether-table-head, ' + C.panel + ')',
                  position: 'sticky', left: 0, zIndex: 2, cursor: 'pointer', fontSize: 11
                }
              }, r + 1),
              Array.from({ length: colCount }, (_, c) => {
                const isAnchor = r === sel.r0 && c === sel.c0
                const isSelected = r >= normSel.r0 && r <= normSel.r1 && c >= normSel.c0 && c <= normSel.c1
                const isFillEdge = !readOnly && r === normSel.r1 && c === normSel.c1
                const inFillRange = fillPreview && r >= fillPreview.r0 && r <= fillPreview.r1 && c >= fillPreview.c0 && c <= fillPreview.c1
                const isEditingCell = editing && editing.row === r && editing.col === c
                const display = String(evaluatedGrid(r, c) ?? '')
                const isNum = DISPLAY_NUMBER_RE.test(display.trim())
                return h('td', {
                  key: c,
                  'data-cell-rc': r + ':' + c,
                  title: getRaw(r, c).startsWith('=') ? getRaw(r, c) : undefined,
                  onPointerDown: (ev) => startCellDrag(r, c, ev),
                  onDoubleClick: () => { if (!readOnly) setEditing({ row: r, col: c, value: getRaw(r, c) }) },
                  className: isNum ? 'tether-num' : undefined,
                  style: {
                    position: 'relative',
                    padding: isEditingCell ? 0 : '4px 8px',
                    textAlign: isNum ? 'right' : 'left',
                    background: isSelected ? selBg : (inFillRange ? fillBg : undefined),
                    boxShadow: isAnchor ? ('inset 0 0 0 2px ' + accent) : (isSelected ? ('inset 0 0 0 1px color-mix(in srgb, ' + accent + ' 45%, transparent)') : undefined),
                    color: display.startsWith('#') ? (C.red || '#d92d20') : C.ink,
                    maxWidth: 240,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'cell'
                  }
                },
                  isEditingCell ? h('input', {
                    ref: editInputRef,
                    autoFocus: true,
                    value: editing.value,
                    onChange: (ev) => setEditing((cur) => cur ? { ...cur, value: ev.target.value } : null),
                    onBlur: () => commitEdit(0, 0),
                    onKeyDown: (ev) => {
                      if (ev.key === 'Enter') { ev.preventDefault(); commitEdit(1, 0) }
                      else if (ev.key === 'Tab') { ev.preventDefault(); commitEdit(0, ev.shiftKey ? -1 : 1) }
                      else if (ev.key === 'Escape') { ev.preventDefault(); setEditing(null); if (rootRef.current) rootRef.current.focus() }
                    },
                    style: {
                      width: '100%', height: 26, boxSizing: 'border-box', padding: '0 7px',
                      border: 0, outline: 'none', background: C.bg, color: C.ink,
                      font: 'inherit', fontSize: 12
                    }
                  }) : display,
                  isFillEdge ? h('span', {
                    title: '拖动填充柄自动填充序列或公式',
                    onPointerDown: startFillHandleDrag,
                    style: {
                      position: 'absolute', right: 0, bottom: 0, width: 7, height: 7,
                      background: accent, borderRadius: 1, cursor: 'crosshair', zIndex: 3
                    }
                  }) : null
                )
              })
            ))
          )
        )
      ),
      // Multi-sheet tabs + live selection summary footer
      !singleSheet ? h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
          borderTop: '1px solid ' + (C.line || 'rgba(0,0,0,0.08)'),
          background: C.panel, flex: '0 0 auto', overflowX: 'auto'
        }
      },
        sheets.map((sheet, idx) => {
          const active = idx === safeSheetIdx
          const isRenaming = renamingSheet && renamingSheet.index === idx
          return h('div', {
            key: idx + ':' + sheet.name,
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 24, padding: '0 8px', borderRadius: 6,
              background: active ? C.bg : 'transparent',
              border: active ? ('1px solid ' + (C.line || 'rgba(0,0,0,0.12)')) : '1px solid transparent',
              color: active ? C.ink : C.mute, fontSize: 11.5, cursor: 'pointer', flex: '0 0 auto'
            }
          },
            isRenaming ? h('input', {
              autoFocus: true, value: renamingSheet.value,
              onChange: (ev) => setRenamingSheet((cur) => cur ? { ...cur, value: ev.target.value } : null),
              onBlur: commitRenameSheet,
              onKeyDown: (ev) => { if (ev.key === 'Enter') commitRenameSheet(); if (ev.key === 'Escape') setRenamingSheet(null) },
              style: { width: 88, height: 18, border: 0, outline: 'none', background: 'transparent', color: C.ink, fontSize: 11.5 }
            }) : h('span', {
              onClick: () => { setSheetIndex(idx); setSel({ r0: 0, c0: 0, r1: 0, c1: 0 }); setEditing(null) },
              onDoubleClick: () => { if (!readOnly) setRenamingSheet({ index: idx, value: sheet.name }) },
              style: { fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }
            }, sheet.name),
            !readOnly && sheets.length > 1 ? h('button', {
              type: 'button', title: '删除工作表', 'aria-label': '删除工作表 ' + sheet.name,
              onClick: (ev) => { ev.stopPropagation(); deleteSheet(idx) },
              style: { border: 0, background: 'transparent', color: C.mute, cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: '12px' }
            }, '×') : null
          )
        }),
        !readOnly ? tbBtn('新建工作表', addSheet, sheets.length >= 20, '+') : null
      ) : null,
      h('div', { className: 'tether-table-status' },
        h('span', { className: 'tether-num' }, rowCount + ' 行 × ' + colCount + ' 列'),
        stats.count > 0 ? h('span', { className: 'tether-num' }, '计数 ' + stats.count) : null,
        stats.numericCount > 0 ? h('span', { className: 'tether-num' }, '求和 ' + Number(stats.sum.toPrecision(12))) : null,
        stats.numericCount > 1 ? h('span', { className: 'tether-num' }, '均值 ' + Number(stats.avg.toPrecision(8))) : null,
        h('span', { style: { marginLeft: 'auto' } }, readOnly ? '只读' : (dirty ? '未保存 · Ctrl+S 保存' : 'Ctrl+S 保存'))
      )
    )
  }
}
