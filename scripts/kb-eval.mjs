#!/usr/bin/env node
/**
 * 知识库召回评测。
 *
 *   npm run kb:eval -- --project <projectId> [--file <path>] [--topK 10] [--json]
 *
 * 黄金集默认读 server/data/kb-eval/<projectId>.jsonl，每行：
 *   {"q":"问题","expectDocs":["fdoc_x"],"expectSnippets":["原句片段"],"type":"通用"}
 *
 * 指标：
 *   - 文档级 Recall@5/@10、MRR（语料很少时会虚高，参考即可）
 *   - 片段级 Recall@5/@10、MRR（答案原文是否出现在 Top K 片段里，更可信）
 *   - 无答案误召回
 */
import fs from 'node:fs'
import path from 'node:path'
import { search } from '../server/kb.js'
import { DATA_DIR } from '../server/db.js'

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const projectId = flag('project')
if (!projectId) {
  console.error('用法：npm run kb:eval -- --project <projectId> [--file <path>] [--topK 10] [--json]')
  process.exit(1)
}

const file = flag('file') || path.join(DATA_DIR, 'kb-eval', `${projectId}.jsonl`)
if (!fs.existsSync(file)) {
  console.error(`找不到黄金集：${file}`)
  console.error('格式（每行一条）：{"q":"问题","expectDocs":["fdoc_id"],"expectSnippets":["原句片段"],"type":"通用"}')
  process.exit(1)
}

const topK = Math.max(Number(flag('topK', 10)) || 10, 1)
const pipelineArg = flag('pipeline', 'hybrid')
const pipeline = ['bm25', 'hybrid', 'hybrid-rerank'].includes(pipelineArg) ? pipelineArg : 'hybrid'
const useVector = pipeline !== 'bm25'
const useRerank = pipeline === 'hybrid-rerank'
const cases = fs.readFileSync(file, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('//'))
  .map((line) => {
    try { return JSON.parse(line) } catch { return null }
  })
  .filter(Boolean)

if (cases.length === 0) {
  console.error('黄金集为空')
  process.exit(1)
}

const ranked = []
for (const item of cases) {
  const result = await search(projectId, item.q, { topK, useVector, useRerank })
  const docIds = result.chunks.map((c) => c.docId)
  const expectDocs = Array.isArray(item.expectDocs) ? item.expectDocs : []
  const snippets = Array.isArray(item.expectSnippets) ? item.expectSnippets : []

  const firstDocHit = expectDocs.length === 0
    ? -1
    : docIds.findIndex((id) => expectDocs.includes(id))

  const firstSnippetHit = snippets.length === 0
    ? -1
    : result.chunks.findIndex((c) => snippets.some((s) => (
      String(c.content).includes(s) || String(c.sectionPath || '').includes(s)
    )))

  ranked.push({
    q: item.q,
    type: item.type || '未分类',
    expectDocs,
    snippets,
    got: docIds,
    firstDocHit,
    firstSnippetHit,
    lowConfidence: result.lowConfidence,
  })
}

const docCases = ranked.filter((r) => r.expectDocs.length > 0)
const snippetCases = ranked.filter((r) => r.snippets.length > 0)
const noAnswer = ranked.filter((r) => r.expectDocs.length === 0 && r.snippets.length === 0)

const ratio = (list, fn) => (list.length === 0 ? 0 : list.filter(fn).length / list.length)
const mrrOf = (list, key) => (list.length === 0
  ? 0
  : list.reduce((acc, r) => acc + (r[key] >= 0 ? 1 / (r[key] + 1) : 0), 0) / list.length)

const docRecall = (k) => ratio(docCases, (r) => r.firstDocHit >= 0 && r.firstDocHit < k)
const snippetRecall = (k) => ratio(snippetCases, (r) => r.firstSnippetHit >= 0 && r.firstSnippetHit < k)
const falseRecall = ratio(noAnswer, (r) => r.got.length > 0 && !r.lowConfidence)

const byType = new Map()
for (const r of snippetCases) {
  const entry = byType.get(r.type) || { total: 0, hit5: 0, hit10: 0 }
  entry.total += 1
  if (r.firstSnippetHit >= 0 && r.firstSnippetHit < 5) entry.hit5 += 1
  if (r.firstSnippetHit >= 0 && r.firstSnippetHit < 10) entry.hit10 += 1
  byType.set(r.type, entry)
}

const failures = ranked.filter((r) => {
  const docBad = r.expectDocs.length > 0 && (r.firstDocHit < 0 || r.firstDocHit >= 10)
  const snippetBad = r.snippets.length > 0 && (r.firstSnippetHit < 0 || r.firstSnippetHit >= 10)
  return docBad || snippetBad
})

const summary = {
  projectId,
  cases: ranked.length,
  docCases: docCases.length,
  snippetCases: snippetCases.length,
  noAnswer: noAnswer.length,
  docRecallAt5: Number(docRecall(5).toFixed(3)),
  docRecallAt10: Number(docRecall(10).toFixed(3)),
  docMrr: Number(mrrOf(docCases, 'firstDocHit').toFixed(3)),
  snippetRecallAt5: Number(snippetRecall(5).toFixed(3)),
  snippetRecallAt10: Number(snippetRecall(10).toFixed(3)),
  snippetMrr: Number(mrrOf(snippetCases, 'firstSnippetHit').toFixed(3)),
  noAnswerFalseRecall: Number(falseRecall.toFixed(3)),
  byType: [...byType.entries()].map(([type, v]) => ({
    type,
    total: v.total,
    recallAt5: Number((v.hit5 / v.total).toFixed(3)),
    recallAt10: Number((v.hit10 / v.total).toFixed(3)),
  })),
  failures: failures.map((r) => ({
    q: r.q,
    type: r.type,
    expectDocs: r.expectDocs,
    snippets: r.snippets,
    got: r.got.slice(0, 3),
  })),
}

if (args.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

console.log(`\n项目 ${projectId} · 用例 ${summary.cases}（文档级 ${summary.docCases} / 片段级 ${summary.snippetCases} / 无答案 ${summary.noAnswer}）`)
console.log('─'.repeat(56))
console.log(`文档 Recall@5   ${summary.docRecallAt5}`)
console.log(`文档 Recall@10  ${summary.docRecallAt10}`)
console.log(`文档 MRR        ${summary.docMrr}`)
console.log(`片段 Recall@5   ${summary.snippetRecallAt5}`)
console.log(`片段 Recall@10  ${summary.snippetRecallAt10}`)
console.log(`片段 MRR        ${summary.snippetMrr}`)
console.log(`无答案误召回     ${summary.noAnswerFalseRecall}`)
console.log('─'.repeat(56))
for (const row of summary.byType) {
  console.log(`${row.type.padEnd(10)} n=${String(row.total).padEnd(3)} R@5=${row.recallAt5}  R@10=${row.recallAt10}`)
}
if (summary.failures.length > 0) {
  console.log('─'.repeat(56))
  console.log('未命中（前 10 条）：')
  for (const f of summary.failures.slice(0, 10)) {
    console.log(`- [${f.type}] ${f.q}\n  期望片段 ${f.snippets.join(' / ') || '—'} / 实际文档 ${f.got.join(',') || '空'}`)
  }
}
console.log('')
