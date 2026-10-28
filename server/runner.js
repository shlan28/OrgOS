import { spawn, spawnSync } from 'node:child_process'
import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import {
  DATA_DIR,
  DEFAULT_WORKDIR,
  appendEvent,
  finishTurn,
  getFeishuDoc,
  getRuntime,
  readSecrets,
  runtimeKey,
  updateSessionDshId,
} from './db.js'
import { search as kbSearch } from './kb.js'
import {
  buildMemoryBlock,
  getMemorySettingsForProject,
  maybeCollectIfDue,
  recallMemories,
} from './memory.js'
import { syncAgentSpecs } from './specs.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

export const CLI_PATH =
  process.env.DSH_BIN || path.join(REPO_ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** turnId → 子进程（用于取消 / 状态查询） */
export const running = new Map()
/** 被主动取消的 turn（close 时标记 canceled 而不是 error） */
const canceledTurns = new Set()
/** turnId 维度的事件总线（SSE 订阅） */
export const bus = new EventEmitter()
bus.setMaxListeners(0)

let versionCache = null

export function cliInfo() {
  const exists = fs.existsSync(CLI_PATH)
  if (!exists) return { exists: false, path: CLI_PATH, version: null }
  if (versionCache === null) {
    try {
      const out = spawnSync(process.execPath, [CLI_PATH, '--version'], { encoding: 'utf8', timeout: 20000 })
      versionCache = (out.stdout || '').trim() || null
    } catch {
      versionCache = null
    }
  }
  return { exists: true, path: CLI_PATH, version: versionCache }
}

const permissionMode = (p) => {
  if (p === 'readonly' || p === 'read-only') return 'read-only'
  if (p === 'full' || p === 'danger-full-access') return 'danger-full-access'
  return 'workspace-write'
}

const YAML_SAFE = /^[A-Za-z0-9._/@:-]+$/
const safeYaml = (value, fallback) => (YAML_SAFE.test(value ?? '') ? value : fallback)

/** 每个 agent 一份模型 / 审批 patch（headless 没有交互式审批通道） */
function writePatch(agent, runtime) {
  const dir = path.join(DATA_DIR, 'patches')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${agent.id}.yml`)
  const provider = safeYaml(runtime?.provider ?? agent.provider, 'deepseek-official')
  const model = safeYaml(agent.model, 'deepseek-chat')
  const approval = agent.permission === 'readonly' ? 'ask' : 'never'
  fs.writeFileSync(file, [
    '- id: agent-default-model',
    '  config:',
    `    provider: ${provider}`,
    `    model: ${model}`,
    '- id: approval',
    '  config:',
    `    policy: ${approval}`,
    '',
  ].join('\n'))
  return file
}

/** 只透传必要的环境变量，避免把无关密钥带进子进程 */
function buildEnv(agent, runtime) {
  const secrets = readSecrets()
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG || 'en_US.UTF-8',
    TMPDIR: process.env.TMPDIR,
    TERM: 'dumb',
    NO_COLOR: '1',
    DSH_HOME: path.join(DATA_DIR, 'dsh', agent.id),
    DSH_PERMISSION_MODE: permissionMode(agent.permission),
  }
  const key = agent.runtimeId ? runtimeKey(agent.runtimeId) : secrets.deepseekApiKey
  if (key) env.DEEPSEEK_API_KEY = key
  const baseUrl = runtime?.baseUrl || secrets.deepseekBaseUrl
  if (baseUrl) env.DEEPSEEK_BASE_URL = baseUrl
  return env
}

function classifyError(message) {
  const m = (message || '').toLowerCase()
  if (m.includes('missing_credential') || m.includes('no api key')) return 'auth'
  if (m.includes('rate limit') || m.includes('429')) return 'rate_limit'
  if (m.includes('timed out') || m.includes('timeout')) return 'timeout'
  return 'unknown'
}

function emitEvent(turn, sessionId, event) {
  try {
    appendEvent(turn.id, sessionId, event.type ?? 'event', event)
  } catch (err) {
    // turn 已被删除（会话删除等）时忽略，不影响进程收尾
    console.error('[runner] appendEvent failed', err?.message || err)
  }
  bus.emit(`turn:${turn.id}`, event)
}

function buildKnowledgeBlock(hits) {
  const blocks = hits.map((hit, index) => (
    `[${index + 1}] 《${hit.docTitle}》${hit.sectionPath ? ` · ${hit.sectionPath}` : ''}\n${String(hit.content).slice(0, 600)}`
  )).join('\n\n')
  return [
    '以下是从项目知识库检索到的相关片段，请优先依据这些内容回答；',
    '如果这些内容不足以回答问题，请明确说明缺少什么，不要编造。',
    '',
    blocks,
  ].join('\n')
}

/** 记忆段 → 知识库段 → 用户问题 */
export function buildTurnPrompt(content, { memoryHits = [], kbHits = [] } = {}) {
  const blocks = []
  if (memoryHits.length > 0) blocks.push(buildMemoryBlock(memoryHits))
  if (kbHits.length > 0) blocks.push(buildKnowledgeBlock(kbHits))
  if (blocks.length === 0) return content
  return [...blocks, '用户问题：', content].join('\n\n')
}

/** 把知识库命中片段拼进提示词（导出便于单测） */
export function buildKnowledgePrompt(content, hits) {
  return buildTurnPrompt(content, { kbHits: hits })
}

/**
 * 启动一轮真实运行：`dsh --profile headless --json`
 * 事件逐行解析 → 落库 → 广播给 SSE 订阅者。
 */
export async function startTurn({ agent, session, turn, content }) {
  const runtime = agent.runtimeId ? getRuntime(agent.runtimeId) : null
  const dshHome = path.join(DATA_DIR, 'dsh', agent.id)
  fs.mkdirSync(dshHome, { recursive: true })
  const patch = writePatch(agent, runtime)

  // 每轮启动前把最新的项目规范写入 AGENTS.md（内容未变则跳过）
  if (session.projectId) syncAgentSpecs(session.projectId, agent)

  // 记忆默认注入：项目总开关 × 本轮开关
  let memoryHits = []
  if (turn.useMemory && session.projectId) {
    try {
      const settings = getMemorySettingsForProject(session.projectId)
      if (settings.injectMemory) {
        memoryHits = await recallMemories(session.projectId, content, { topK: 5, sessionId: session.id })
        if (memoryHits.length > 0) {
          emitEvent(turn, session.id, {
            type: 'memory_recall',
            query: content,
            count: memoryHits.length,
            memories: memoryHits,
          })
        }
      }
    } catch (err) {
      console.error('[runner] memory recall failed', err?.message || err)
    }
  }

  // 勾选了「使用知识库」时，先检索并拼进提示词
  let kbHits = []
  if (turn.useKnowledge && session.projectId) {
    try {
      const result = await kbSearch(session.projectId, content, { topK: 6 })
      kbHits = result.chunks.map((chunk) => {
        const doc = getFeishuDoc(chunk.docId)
        return { ...chunk, docTitle: doc?.title || '未知文档' }
      })
      emitEvent(turn, session.id, {
        type: 'kb_search',
        query: content,
        chunks: kbHits.map((h) => ({ title: h.docTitle, sectionPath: h.sectionPath, score: h.score })),
        lowConfidence: result.lowConfidence,
      })
    } catch (err) {
      console.error('[runner] kb search failed', err?.message || err)
    }
  }

  const prompt = buildTurnPrompt(content, { memoryHits, kbHits })

  // 启动器参数（--patch）必须排在应用参数（--json / --session-id）之前
  const args = [CLI_PATH, '--profile', 'headless', '--patch', patch, '--json']
  if (session.dshSessionId) args.push('--session-id', session.dshSessionId)
  args.push(prompt)

  const cwd = agent.workdir && fs.existsSync(agent.workdir) ? agent.workdir : DEFAULT_WORKDIR

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, args, {
        cwd,
        env: buildEnv(agent, runtime),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      fail(turn, session, `无法启动 dsh：${err.message}`)
      resolve()
      return
    }

    running.set(turn.id, child)
    let sawFinal = false
    let sawTurnError = false
    let stderr = ''

    const rl = readline.createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      const text = line.trim()
      if (!text) return
      let event
      try { event = JSON.parse(text) } catch { return }

      if (event.type === 'session' && event.sessionId) {
        updateSessionDshId(session.id, event.sessionId)
      }
      if (event.type === 'final') sawFinal = true
      if (event.type === 'status' && event.phase === 'turn_end' && event.reason?.kind === 'error') sawTurnError = true

      emitEvent(turn, session.id, event)
    })

    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      stderr += `\n${err.message}`
    })

    child.on('close', (code) => {
      running.delete(turn.id)
      const canceled = canceledTurns.delete(turn.id)
      const message = stderr.trim()

      if (!canceled && !sawFinal && !sawTurnError) {
        const text = message || `dsh 退出（code ${code}）`
        emitEvent(turn, session.id, {
          type: 'error',
          code: classifyError(text),
          message: text,
        })
      }

      const failed = !canceled && (sawTurnError || (!sawFinal && code !== 0))
      const status = canceled ? 'canceled' : failed ? 'error' : 'done'
      finishTurn(turn.id, status, canceled ? null : failed ? (message || 'turn failed') : null)
      bus.emit(`turn:${turn.id}:done`, { status })
      if (status === 'done') {
        void maybeCollectIfDue({ agent, session }).catch((err) => {
          console.error('[memory] collect failed', err?.message || err)
        })
      }
      resolve()
    })
  })
}

function fail(turn, session, message) {
  emitEvent(turn, session.id, { type: 'error', code: 'unknown', message })
  finishTurn(turn.id, 'error', message)
  bus.emit(`turn:${turn.id}:done`, { status: 'error' })
}

export function cancelTurn(turnId) {
  const child = running.get(turnId)
  if (!child) return false
  canceledTurns.add(turnId)
  child.kill('SIGTERM')
  running.delete(turnId)
  return true
}

/** 进程退出时清理所有子进程 */
export function killAll() {
  for (const child of running.values()) {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  }
  running.clear()
}
