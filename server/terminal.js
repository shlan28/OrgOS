import { WebSocketServer } from 'ws'
import pty from 'node-pty'
import { getAuthSession, getProject } from './db.js'
import {
  ensureSandboxRunning,
  sandboxContainerName,
  terminalConnected,
  terminalDisconnected,
} from './docker.js'

const SESSION_COOKIE = 'org_session'
const PATH_RE = /^\/api\/projects\/([^/]+)\/sandbox\/terminal$/

const parseCookies = (header = '') => Object.fromEntries(
  header.split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      return i < 0 ? [pair, ''] : [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))]
    }),
)

const clamp = (value, min, max, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const canAccess = (user, project) => Boolean(
  user && project && (
    user.permission === '所有者'
    || user.permission === '管理员'
    || project.members.some((m) => m.name === user.name)
  ),
)

const reject = (socket, status, message) => {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

const openPtys = new Set()
let wss = null

/** 挂到既有 http.Server（app.listen 的返回值）上 */
export function attachTerminal(server) {
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url || '', 'http://localhost')
    } catch {
      return reject(socket, 400, 'Bad Request')
    }
    const match = PATH_RE.exec(url.pathname)
    if (!match) return reject(socket, 404, 'Not Found')

    const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || ''
    const user = getAuthSession(token)
    if (!user) return reject(socket, 401, 'Unauthorized')

    const project = getProject(decodeURIComponent(match[1]))
    if (!project) return reject(socket, 404, 'Not Found')
    if (!canAccess(user, project)) return reject(socket, 403, 'Forbidden')
    if (project.type !== 'dev') return reject(socket, 400, 'No Sandbox')

    const cols = clamp(url.searchParams.get('cols'), 20, 500, 80)
    const rows = clamp(url.searchParams.get('rows'), 8, 200, 24)

    wss.handleUpgrade(req, socket, head, (ws) => {
      setupConnection(ws, project, cols, rows)
    })
  })

  return wss
}

function setupConnection(ws, project, cols, rows) {
  let ptyProcess = null
  let closed = false
  let heartbeat = null

  const sendStatus = (phase, message = '') => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'status', phase, message }))
  }

  const cleanup = () => {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    if (ptyProcess) {
      try { ptyProcess.kill() } catch { /* ignore */ }
      openPtys.delete(ptyProcess)
      ptyProcess = null
    }
    terminalDisconnected(project.id)
  }

  terminalConnected(project.id)
  sendStatus('starting', '正在准备沙箱…')

  ;(async () => {
    let container = ''
    try {
      container = await ensureSandboxRunning(project)
    } catch (err) {
      sendStatus('error', err?.message || '沙箱启动失败')
      ws.close()
      return
    }
    if (closed) return

    try {
      ptyProcess = pty.spawn('docker', [
        'exec', '-it',
        '-e', 'TERM=xterm-256color',
        '-e', 'USER=sandbox',
        '-e', 'LOGNAME=sandbox',
        '-e', 'PS1=sandbox@\\h:\\w\\$ ',
        container,
        'bash', '--noprofile', '--norc',
      ], {
        name: 'xterm-256color',
        cols,
        rows,
        env: { ...process.env, TERM: 'xterm-256color', DOCKER_CLI_HINTS: 'false' },
      })
      openPtys.add(ptyProcess)
    } catch (err) {
      sendStatus('error', `无法启动终端：${err?.message || err}`)
      ws.close()
      return
    }

    sendStatus('ready')

    ptyProcess.onData((data) => {
      if (ws.readyState !== ws.OPEN) return
      if (ws.bufferedAmount > 1024 * 1024) return
      ws.send(Buffer.from(data, 'utf8'))
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }))
        ws.close()
      }
    })

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (!ptyProcess) return
      if (msg.type === 'input' && typeof msg.data === 'string') {
        ptyProcess.write(msg.data)
      } else if (msg.type === 'resize') {
        const nextCols = clamp(msg.cols, 20, 500, cols)
        const nextRows = clamp(msg.rows, 8, 200, rows)
        try { ptyProcess.resize(nextCols, nextRows) } catch { /* ignore */ }
      }
    })

    heartbeat = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return
      ws.ping()
    }, 30000)
  })()

  ws.on('close', cleanup)
  ws.on('error', cleanup)
}

/** 服务端退出时清理所有终端 */
export function closeTerminalServer() {
  for (const p of openPtys) {
    try { p.kill() } catch { /* ignore */ }
  }
  openPtys.clear()
  if (wss) {
    for (const client of wss.clients) {
      try { client.terminate() } catch { /* ignore */ }
    }
    wss.close()
    wss = null
  }
}
