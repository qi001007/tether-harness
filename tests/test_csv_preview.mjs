import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  TABLE_PREVIEW_MAX_COLUMNS,
  TABLE_PREVIEW_MAX_ROWS,
  buildTablePreview,
  parseDelimited,
  serializeDelimited,
  tableNumericColumns,
  tablePreviewFormat
} from '../packages/tether-ui/src/app.js'

const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8')
const model = (text, extra) => buildTablePreview({ name: 'data.csv', text, ...(extra || {}) })

test('csv and tsv are table files, xlsx reuses the node tab export, others are not', () => {
  assert.deepEqual(tablePreviewFormat('a.CSV'), { delimiter: ',', quoted: true })
  assert.deepEqual(tablePreviewFormat('a.tsv'), { delimiter: '\t', quoted: true })
  assert.deepEqual(tablePreviewFormat('a.xlsx'), { delimiter: '\t', quoted: false })
  assert.deepEqual(tablePreviewFormat('a.xlsm'), { delimiter: '\t', quoted: false })
  assert.equal(tablePreviewFormat('a.txt'), null)
  assert.equal(tablePreviewFormat('a.json'), null)
  assert.equal(buildTablePreview({ name: 'a.txt', text: 'x' }), null)
})

test('the first row is the header and short rows are padded', () => {
  const table = model('name,qty\napple,2\npear\n')
  assert.deepEqual(table.headers, ['name', 'qty'])
  assert.deepEqual(table.rows, [['apple', '2'], ['pear', '']])
  assert.equal(table.columnCount, 2)
})

test('quoted fields keep commas, escaped quotes and line breaks (RFC4180)', () => {
  const table = model('id,note\n1,"a,b"\n2,"say ""hi"""\n3,"two\nlines"\n')
  assert.deepEqual(table.rows, [['1', 'a,b'], ['2', 'say "hi"'], ['3', 'two\nlines']])
  assert.equal(table.columnCount, 2)
})

test('CRLF and lone CR become row breaks, quoted CRLF becomes a field newline', () => {
  const table = model('a,b\r\n1,"x\r\ny"\r2,3\r')
  assert.deepEqual(table.rows, [['1', 'x\ny'], ['2', '3']])
})

test('a UTF-8 BOM is dropped from the first header cell', () => {
  const table = model('\uFEFFname,age\nann,30\n')
  assert.equal(table.headers[0], 'name')
  assert.deepEqual(table.rows, [['ann', '30']])
})

test('empty cells and empty rows are preserved, a trailing newline adds no row', () => {
  const table = model('a,b,c\n1,,3\n\n,x,\n')
  assert.deepEqual(table.rows, [['1', '', '3'], ['', '', ''], ['', 'x', '']])
  assert.deepEqual(parseDelimited('a,b,c\n1,,3\n\n,x,\n').rows[2], [''])
  assert.equal(model('a,b\n1,2\n').rows.length, 1)
  assert.equal(model('a,b\n1,2').rows.length, 1)
})

test('empty and header-only files produce an empty body instead of a phantom row', () => {
  assert.deepEqual(model(''), { headers: [], rows: [], columnCount: 0, numericColumns: [], truncatedRows: false, truncatedColumns: false, sourceTruncated: false, droppedPartialRow: false, rowLimit: 5000, columnLimit: 100 })
  const headerOnly = model('a,b\n')
  assert.deepEqual(headerOnly.headers, ['a', 'b'])
  assert.deepEqual(headerOnly.rows, [])
})

test('blank header cells fall back to their column number', () => {
  const table = model(',b,\n1,2,3\n')
  assert.deepEqual(table.headers, ['列 1', 'b', '列 3'])
})

test('the row cap stops parsing and reports truncation', () => {
  const rows = ['id,v']
  for (let i = 0; i < 10; i += 1) rows.push(i + ',x')
  const table = model(rows.join('\n'), { rowLimit: 3 })
  assert.equal(table.rows.length, 3)
  assert.equal(table.truncatedRows, true)
  const exact = model('id,v\n1,x\n2,x\n3,x', { rowLimit: 3 })
  assert.equal(exact.rows.length, 3)
  assert.equal(exact.truncatedRows, false)
})

test('the default row cap is 5000 data rows', () => {
  const rows = ['id,v']
  for (let i = 0; i < TABLE_PREVIEW_MAX_ROWS + 5; i += 1) rows.push(i + ',x')
  const table = model(rows.join('\n'))
  assert.equal(table.rows.length, TABLE_PREVIEW_MAX_ROWS)
  assert.equal(table.truncatedRows, true)
})

test('the column cap drops extra cells and reports truncation', () => {
  const table = model('a,b,c,d,e\n1,2,3,4,5\n', { columnLimit: 3 })
  assert.equal(table.columnCount, 3)
  assert.deepEqual(table.headers, ['a', 'b', 'c'])
  assert.deepEqual(table.rows, [['1', '2', '3']])
  assert.equal(table.truncatedColumns, true)
  assert.equal(model('a,b\n1,2\n').truncatedColumns, false)
  assert.equal(TABLE_PREVIEW_MAX_COLUMNS, 100)
})

test('tsv splits on tabs and keeps quoted tabs inside a cell', () => {
  const table = model('a\tb\n"x\ty"\t2\n', { name: 'data.tsv' })
  assert.deepEqual(table.headers, ['a', 'b'])
  assert.deepEqual(table.rows, [['x\ty', '2']])
})

test('xlsx tab text is read without quote syntax', () => {
  const table = model('"quoted"\t2\nplain\t3\n', { name: 'book.xlsx' })
  assert.deepEqual(table.headers, ['"quoted"', '2'])
  assert.deepEqual(table.rows, [['plain', '3']])
})

test('a quote in the middle of a field stays literal', () => {
  const table = model('a,b\n12" screen,x\n')
  assert.deepEqual(table.rows, [['12" screen', 'x']])
})

test('an unterminated quote keeps the remainder instead of throwing', () => {
  const parsed = parseDelimited('a,b\n1,"cut')
  assert.deepEqual(parsed.rows, [['a', 'b'], ['1', 'cut']])
  assert.equal(parsed.openQuote, true)
  assert.equal(parsed.endedWithNewline, false)
})

test('a truncated node preview drops the half record but keeps complete rows', () => {
  const cut = model('a,b\n1,2\n3,4', { sourceTruncated: true })
  assert.deepEqual(cut.rows, [['1', '2']])
  assert.equal(cut.droppedPartialRow, true)
  assert.equal(cut.sourceTruncated, true)
  const complete = model('a,b\n1,2\n3,4\n', { sourceTruncated: true })
  assert.deepEqual(complete.rows, [['1', '2'], ['3', '4']])
  assert.equal(complete.droppedPartialRow, false)
})

test('numeric columns are detected for right-aligned tabular digits', () => {
  const columns = tableNumericColumns([['1,200', 'a'], ['2.5', 'b'], ['-3', 'c'], ['4%', 'd']], 2)
  assert.deepEqual(columns, [true, false])
  assert.deepEqual(tableNumericColumns([['1', 'x'], ['', 'y']], 2), [false, false])
  assert.deepEqual(tableNumericColumns([['2026-10-29', 'x'], ['2026-10-30', 'y']], 2), [false, false])
})

test('quoted empty fields and delimiter-only lines stay aligned', () => {
  const table = model('a,b\n"",\n,\n')
  assert.deepEqual(table.rows, [['', ''], ['', '']])
})

test('the explorer renders a sticky, scrollable table with a text toggle', () => {
  assert.match(source, /if \(tablePreview && tableView\) return tableEdit \? tableEditBody\(\) : tablePreviewBody\(tablePreview\)/)
  assert.match(source, /className: 'tether-scroll tether-table-scroll'/)
  assert.match(source, /className: 'tether-table', 'aria-label': '只读表格预览'/)
  assert.match(source, /\.tether-table th \{ position: sticky; top: 0;/)
  assert.match(source, /\.tether-table-scroll \{ flex: 1 1 auto; min-height: 0; overflow: auto;/)
  assert.match(source, /\.tether-table \{ border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%;/)
  assert.match(source, /\.tether-table-status \{/)
  assert.match(source, /viewToggle\('table', '表格', tableView, \(\) => setTableView\(true\)\)/)
  assert.match(source, /viewToggle\('plainText', '纯文本', !tableView, \(\) => setTableView\(false\)\)/)
  assert.match(source, /\.tether-viewtoggle-btn\[data-active=true\]/)
  assert.match(source, /--tether-table-head: color-mix\(in srgb, var\(--dsw-alias-label-primary/)
  assert.match(source, /--tether-table-grid: color-mix\(in srgb, var\(--dsw-alias-label-primary/)
  assert.match(source, /tether-table-warn \{ color: var\(--dsw-alias-state-warn-primary/)
  assert.match(source, /if \(!sameFile\) setTableView\(true\)/)
})

test('serializeDelimited round-trips CSV quoting, delimiters and line endings', () => {
  const rows = [['a', 'b,c', 'he said "hi"'], ['1', 'line1\nline2', '']]
  assert.equal(serializeDelimited(rows, { delimiter: ',', quoted: true }), 'a,"b,c","he said ""hi"""\n1,"line1\nline2",\n')
  assert.equal(serializeDelimited(rows, { delimiter: ',', quoted: true, newline: '\r\n' }), 'a,"b,c","he said ""hi"""\r\n1,"line1\nline2",\r\n')
  assert.equal(serializeDelimited([['a', 'b', 'c']], { delimiter: '\t', quoted: true }), 'a\tb\tc\n')
  assert.equal(serializeDelimited([['a\tb', 'c']], { delimiter: '\t', quoted: false }), 'a b\tc\n')
  const parsed = parseDelimited(serializeDelimited(rows, { delimiter: ',', quoted: true }), { delimiter: ',', quoted: true })
  assert.deepEqual(parsed.rows, rows)
})

test('CSV/TSV tables edit in place and read the DOM back on save', () => {
  assert.match(source, /export function serializeDelimited\(rows, options = \{\}\)/)
  assert.match(source, /contentEditable: true, suppressContentEditableWarning: true/)
  assert.match(source, /className: 'tether-table tether-table-edit'/)
  assert.match(source, /const saveTable = async \(\) => \{/)
  assert.match(source, /const table = document\.querySelector\('\.tether-table-edit'\)/)
  assert.match(source, /serializeDelimited\(rows, \{ delimiter: format\.delimiter, quoted: format\.quoted, newline: format\.newline/)
  assert.match(source, /tableEdit \? iconButton\('eye', '退出表格编辑', cancelTableEdit, false\)/)
  assert.match(source, /tablePreview && tableView && tableCanEdit && file\.writable \? iconButton\('pencil', '编辑表格', startTableEdit, false\)/)
  assert.match(source, /const tableCanEdit = !!\(file && tablePreview && tableFormatOf\(file\) && !file\.truncated && !tablePreview\.truncatedRows && !tablePreview\.truncatedColumns\)/)
})
