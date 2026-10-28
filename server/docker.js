import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensureProjectSandbox, projectSandboxDir, safeProjectId } from './sandbox.js'

const execFileAsync = promisify(execFile)

// 默认使用本机已存在的轻量镜像；需要 node/git 时用 ORG_OS_SANDBOX_IMAGE 覆盖
export const SANDBOX_IMAGE = process.env.ORG_OS_SANDBOX_IMAGE || 'ubuntu:latest'
export const SANDBOX_LIMITS = {
  cpus: process.env.ORG_OS_SANDBOX_CPUS || '2',
  memory: process.env.ORG_OS_SANDBOX_MEMORY || '4g',
  pids: process.env.ORG_OS_SANDBOX_PIDS || '512',
}
const IDLE_MS = Number(process.env.ORG_OS_SANDBOX_IDLE_MS || 15 * 60 * 1000)
const FIXED_NETWORK = (process.env.ORG_OS_SANDBOX_NETWORK || '').trim()

const containerNameOf = (projectId) => `org-os-sbx-${safeProjectId(projectId)}`
const networkNameOf = (projectId) => `org-os-net-${safeProjectId(projectId)}`

const docker = async (args, timeout = 120000) => {
  const { stdout, stderr } = await execFileAsync('docker', args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  })
  return { stdout: stdout.trim(), stderr: stderr.trim() }
}

/* —— daemon 状态（缓存 10s） —— */
let daemonCache = { at: 0, available: false, version: '', error: '未检测' }

export async function dockerDaemon(force = false) {
  if (!force && Date.now() - daemonCache.at < 10000) return daemonCache
  try {
    const { stdout } = await docker(['info', '--format', '{{.ServerVersion}}'], 4000)
    daemonCache = { at: Date.now(), available: true, version: stdout, error: '' }
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).split('\n')[0]
    daemonCache = { at: Date.now(), available: false, version: '', error: detail }
  }
  return daemonCache
}

/* —— 项目状态与操作串行化 —— */
const states = new Map() // projectId → { phase, message, at }
const locks = new Map()

const setState = (projectId, phase, message = '') => {
  states.set(projectId, { phase, message, at: Date.now() })
}

const withLock = (projectId, fn) => {
  const prev = locks.get(projectId) || Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(projectId, next.then(() => {}, () => {}))
  return next
}

const inspectRunning = async (name) => {
  try {
    const { stdout } = await docker(['inspect', '-f', '{{.State.Running}}', name], 10000)
    return stdout === 'true'
  } catch {
    return false
  }
}

const containerExists = async (name) => {
  try {
    await docker(['inspect', '-f', '{{.Id}}', name], 10000)
    return true
  } catch {
    return false
  }
}

const ensureNetwork = async (projectId) => {
  if (FIXED_NETWORK) return FIXED_NETWORK
  const name = networkNameOf(projectId)
  try {
    await docker(['network', 'inspect', name], 10000)
  } catch {
    await docker([
      'network', 'create',
      '--label', 'org-os.sandbox=1',
      '--label', `org-os.project=${projectId}`,
      name,
    ], 30000)
  }
  return name
}

const ensureImage = async (projectId) => {
  try {
    await docker(['image', 'inspect', SANDBOX_IMAGE], 10000)
  } catch {
    setState(projectId, 'starting', `正在拉取沙箱镜像 ${SANDBOX_IMAGE}…`)
    await docker(['pull', SANDBOX_IMAGE], 15 * 60 * 1000)
  }
}

const runArgs = (projectId, network) => {
  const dir = projectSandboxDir(projectId)
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000
  return [
    'run', '-d',
    '--name', containerNameOf(projectId),
    '--label', 'org-os.sandbox=1',
    '--label', `org-os.project=${projectId}`,
    '--hostname', 'sandbox',
    '--init',
    '--cpus', SANDBOX_LIMITS.cpus,
    '--memory', SANDBOX_LIMITS.memory,
    '--memory-swap', SANDBOX_LIMITS.memory,
    '--pids-limit', String(SANDBOX_LIMITS.pids),
    '--network', network,
    '--read-only',
    '--tmpfs', '/tmp:size=512m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', `${uid}:${gid}`,
    '-e', 'HOME=/home/sandbox',
    '-v', `${dir}:/workspace`,
    '-v', `${dir}/home:/home/sandbox`,
    '-w', '/workspace',
    SANDBOX_IMAGE,
    'sleep', 'infinity',
  ]
}

/** 确保容器运行，返回容器名（供终端 docker exec 使用） */
export async function ensureSandboxRunning(project) {
  if (!project || project.type !== 'dev') throw new Error('非研发项目没有沙箱')
  return withLock(project.id, async () => {
    const id = project.id
    const daemon = await dockerDaemon(true)
    if (!daemon.available) throw new Error(`Docker 未运行：${daemon.error || '请启动 Docker Desktop'}`)

    ensureProjectSandbox(project)
    const name = containerNameOf(id)
    setState(id, 'starting', '正在准备沙箱…')

    const network = await ensureNetwork(id)
    try {
      await ensureImage(id)
    } finally {
      // 即使镜像准备失败也要把状态置为可重试
    }

    if (await inspectRunning(name)) {
      setState(id, 'running', '')
      return name
    }
    if (await containerExists(name)) {
      await docker(['start', name], 30000)
    } else {
      await docker(runArgs(id, network), 60000)
    }
    setState(id, 'running', '')
    return name
  })
}

/** 启动沙箱（后台执行，立即返回状态给前端轮询） */
export function startSandbox(project) {
  if (!project || project.type !== 'dev') return getSandboxStatus(project)
  setState(project.id, 'starting', '正在准备沙箱…')
  void ensureSandboxRunning(project).catch((err) => {
    const message = err?.message || '沙箱启动失败'
    setState(project.id, 'error', message)
  })
  return getSandboxStatus(project)
}

/** 停止容器（保留卷） */
export async function stopSandboxById(projectId) {
  clearIdle(projectId)
  const name = containerNameOf(projectId)
  try {
    if (await containerExists(name)) await docker(['stop', '-t', '5', name], 30000)
    setState(projectId, 'stopped', '')
  } catch (err) {
    setState(projectId, 'error', err?.message || '停止沙箱失败')
  }
}

export async function stopSandbox(project) {
  if (!project) return
  await withLock(project.id, () => stopSandboxById(project.id))
}

/* —— 沙箱状态 —— */
export async function getSandboxStatus(project) {
  if (!project || project.type !== 'dev') {
    return {
      enabled: false,
      status: 'disabled',
      message: '非研发项目没有沙箱',
      sandboxDir: null,
      container: null,
      image: SANDBOX_IMAGE,
      limits: SANDBOX_LIMITS,
      daemon: { available: false, version: '', error: '' },
    }
  }
  const daemon = await dockerDaemon()
  const name = containerNameOf(project.id)
  const running = daemon.available ? await inspectRunning(name) : false
  const state = states.get(project.id)
  let status = 'stopped'
  if (!daemon.available) status = 'docker_unavailable'
  else if (running) status = 'running'
  else if (state?.phase === 'starting') status = 'starting'
  else if (state?.phase === 'error') status = 'error'
  else status = 'stopped'

  return {
    enabled: true,
    status,
    message: state?.message || (status === 'docker_unavailable' ? (daemon.error || '请启动 Docker Desktop') : ''),
    sandboxDir: projectSandboxDir(project.id),
    container: name,
    image: SANDBOX_IMAGE,
    limits: SANDBOX_LIMITS,
    daemon: { available: daemon.available, version: daemon.version, error: daemon.error },
  }
}

export const sandboxContainerName = containerNameOf

/* —— 终端连接计数与空闲停止 —— */
const clients = new Map()
const idleTimers = new Map()

const clearIdle = (projectId) => {
  const timer = idleTimers.get(projectId)
  if (timer) clearTimeout(timer)
  idleTimers.delete(projectId)
}

const scheduleIdleStop = (projectId) => {
  clearIdle(projectId)
  if (IDLE_MS <= 0) return
  const timer = setTimeout(() => {
    idleTimers.delete(projectId)
    if ((clients.get(projectId) || 0) > 0) return
    void stopSandboxById(projectId)
  }, IDLE_MS)
  timer.unref?.()
  idleTimers.set(projectId, timer)
}

export function terminalConnected(projectId) {
  clients.set(projectId, (clients.get(projectId) || 0) + 1)
  clearIdle(projectId)
}

export function terminalDisconnected(projectId) {
  const next = Math.max(0, (clients.get(projectId) || 1) - 1)
  clients.set(projectId, next)
  if (next === 0) scheduleIdleStop(projectId)
}
