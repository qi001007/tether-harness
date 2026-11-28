import assert from 'node:assert/strict'
import test from 'node:test'
import {
  colIndexToLetter,
  letterToColIndex,
  parseCellRef,
  shiftFormulaRefs,
  evalSpreadsheetFormula,
  parseTsvClipboard,
  serializeTsvClipboard,
  fillRangeValues,
  computeSelectionStats,
  inferAutoSumPlacements,
  trimWorkbookForSave
} from '../packages/tether-ui/src/spreadsheet-editor.js'
import { pointInSafeTriangle } from '../packages/tether-ui/src/ui-controls.js'

test('column letters round-trip across single and multi-letter columns', () => {
  assert.equal(colIndexToLetter(0), 'A')
  assert.equal(colIndexToLetter(25), 'Z')
  assert.equal(colIndexToLetter(26), 'AA')
  assert.equal(colIndexToLetter(701), 'ZZ')
  assert.equal(letterToColIndex('A'), 0)
  assert.equal(letterToColIndex('aa'), 26)
  assert.equal(letterToColIndex('zz'), 701)
  assert.deepEqual(parseCellRef('$C$12'), { row: 11, col: 2, colAbs: true, rowAbs: true })
  assert.equal(parseCellRef('SUM'), null)
})

test('formula evaluator supports SUM, AVERAGE, COUNT, MIN, MAX, IF, ROUND, ABS, arithmetic and cycle detection', () => {
  const sheet = [
    ['10', '20', '=SUM(A1:B1)', '=AVERAGE(A1:B1)'],
    ['30', 'abc', '=COUNT(A1:B2)', '=IF(C1>25, ROUND(A1/3, 2), 0)'],
    ['=B3', '=A3', '=A1/0', '=MIN(A1:A2)+MAX(A1:B1)']
  ]
  const get = (r, c) => (sheet[r] && sheet[r][c]) ?? ''

  assert.equal(evalSpreadsheetFormula(sheet[0][2], get), '30')
  assert.equal(evalSpreadsheetFormula(sheet[0][3], get), '15')
  assert.equal(evalSpreadsheetFormula(sheet[1][2], get), '3')
  assert.equal(evalSpreadsheetFormula(sheet[1][3], get), '3.33')
  assert.equal(evalSpreadsheetFormula(sheet[2][0], get), '#CYCLE!')
  assert.equal(evalSpreadsheetFormula(sheet[2][2], get), '#DIV/0!')
  assert.equal(evalSpreadsheetFormula(sheet[2][3], get), '30')
  assert.equal(evalSpreadsheetFormula('=ABS(-4.5)*2', get), '9')
})

test('shiftFormulaRefs preserves $ anchors and shifts relative cell refs only', () => {
  assert.equal(shiftFormulaRefs('=SUM(A1:$B$5)+C2', 2, 1), '=SUM(B3:$B$5)+D4')
  assert.equal(shiftFormulaRefs('=IF(A1>0, "A1", B1)', 1, 0), '=IF(A2>0, "A1", B2)')
})

test('fillRangeValues extrapolates arithmetic series and relative formulas', () => {
  assert.deepEqual(
    fillRangeValues([['10'], ['20']], 5, 1, 'down'),
    [['10'], ['20'], ['30'], ['40'], ['50']]
  )
  assert.deepEqual(
    fillRangeValues([['=A1+B1']], 3, 1, 'down'),
    [['=A1+B1'], ['=A2+B2'], ['=A3+B3']]
  )
  assert.deepEqual(
    fillRangeValues([['1', '2']], 1, 4, 'right'),
    [['1', '2', '3', '4']]
  )
})

test('TSV clipboard helpers round-trip multi-cell tabular regions', () => {
  const rows = [['Name', 'Note'], ['Server', 'line1\nline2'], ['Total', '=SUM(B2:B2)']]
  const serialized = serializeTsvClipboard(rows)
  assert.deepEqual(parseTsvClipboard(serialized), rows)
})

test('computeSelectionStats and inferAutoSumPlacements work for ranges and single cells', () => {
  const rows = [
    ['Item', 'Q1', 'Q2'],
    ['A', '10', '20'],
    ['B', '30', '40'],
    ['', '', '']
  ]
  const stats = computeSelectionStats(rows, { r0: 1, c0: 1, r1: 2, c1: 2 })
  assert.equal(stats.count, 4)
  assert.equal(stats.numericCount, 4)
  assert.equal(stats.sum, 100)
  assert.equal(stats.avg, 25)
  assert.equal(stats.min, 10)
  assert.equal(stats.max, 40)

  assert.deepEqual(
    inferAutoSumPlacements(rows, { r0: 3, c0: 1, r1: 3, c1: 1 }),
    [{ row: 3, col: 1, formula: '=SUM(B2:B3)' }]
  )
  assert.deepEqual(
    inferAutoSumPlacements(rows, { r0: 1, c0: 1, r1: 2, c1: 2 }),
    [
      { row: 3, col: 1, formula: '=SUM(B2:B3)' },
      { row: 3, col: 2, formula: '=SUM(C2:C3)' }
    ]
  )
})

test('trimWorkbookForSave strips trailing empty columns and rows', () => {
  const trimmed = trimWorkbookForSave({
    format: 'xlsx',
    sheets: [{ name: 'Sheet1', rows: [['a', 'b', ''], ['1', '', ''], ['', '', '']] }]
  })
  assert.deepEqual(trimmed.sheets[0].rows, [['a', 'b'], ['1']])
})

test('pointInSafeTriangle detects points inside hover prediction cone', () => {
  const apex = { x: 100, y: 100 }
  const top = { x: 200, y: 40 }
  const bottom = { x: 200, y: 220 }
  assert.equal(pointInSafeTriangle({ x: 150, y: 120 }, apex, top, bottom), true)
  assert.equal(pointInSafeTriangle({ x: 150, y: 20 }, apex, top, bottom), false)
  assert.equal(pointInSafeTriangle({ x: 60, y: 100 }, apex, top, bottom), false)
})
