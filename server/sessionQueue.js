import {
  cancelQueuedTurns,
  deleteSession,
  enqueueTurn,
  finishTurn,
  getProject,
  getSession,
  getTurn,
  listAllSessionIds,
  listProjectAgents,
  listSessionsWithQueuedTurns,
  listTurns,
  markRunningTurnsInterrupted,
  markTurnCanceled,
  markTurnRunning,
  nextQueuedTurn,
  recomputeSessionStatus,
} from './db.js'
import { bus, cancelTurn, startTurn } from './runner.js'

/** sessionId → 常驻 worker Promise（同一会话串行执行） */
const workers = new Map()

const hasQueued = (sessionId) => Boolean(nextQueuedTurn(sessionId))

/** 向会话 SSE 频道广播（携带最新 session / turn） */
const emitSession = (sessionId, turnId) => {
  const session = getSession(sessionId)
  if (!session) return
  const turn = turnId ? getTurn(turnId) : null
  bus.emit(`session:${sessionId}`, { type: 'turn', turn, session })
}

/** 入队并确保 worker 已启动 */
export function enqueue({ sessionId, content, userName, useKnowledge = false, useMemory = true }) {
  const turn = enqueueTurn(sessionId, content, userName, useKnowledge, useMemory)
  kick(sessionId)
  // worker 可能已同步把本条置为 running，返回最新状态给前端
  const fresh = getTurn(turn.id)
  emitSession(sessionId, turn.id)
  return fresh
}

/** 启动（或复用）会话 worker */
export function kick(sessionId) {
  if (workers.has(sessionId)) return
  const promise = runWorker(sessionId).finally(() => {
    workers.delete(sessionId)
    // worker 退出前又有新消息入队：重新拉起
    if (hasQueued(sessionId)) kick(sessionId)
  })
  workers.set(sessionId, promise)
}

async function runWorker(sessionId) {
  for (;;) {
    const session = getSession(sessionId)
    if (!session) return

    const turn = nextQueuedTurn(sessionId)
    if (!turn) {
      recomputeSessionStatus(sessionId)
      return
    }

    const project = session.projectId ? getProject(session.projectId) : null
    const agent = project ? listProjectAgents(project.id)[0] : null

    if (!agent) {
      markTurnRunning(turn.id, null, '')
      finishTurn(turn.id, 'error', '项目没有可用 agent')
      bus.emit(`turn:${turn.id}:done`, { status: 'error' })
      recomputeSessionStatus(sessionId)
      emitSession(sessionId, turn.id)
      continue
    }

    markTurnRunning(turn.id, agent.id, agent.name)
    recomputeSessionStatus(sessionId)
    emitSession(sessionId, turn.id)

    try {
      await startTurn({
        agent,
        session,
        turn: getTurn(turn.id),
        content: turn.userContent,
      })
    } catch (err) {
      finishTurn(turn.id, 'error', err?.message || '执行失败')
      bus.emit(`turn:${turn.id}:done`, { status: 'error' })
    }
    recomputeSessionStatus(sessionId)
    emitSession(sessionId, turn.id)
  }
}

/** 取消会话内排队/运行中的 turn；等待 worker 收尾（最多 5s） */
export function cancelSessionQueue(sessionId) {
  const queued = listTurns(sessionId).filter((t) => t.status === 'queued')
  for (const t of queued) {
    markTurnCanceled(t.id)
    bus.emit(`turn:${t.id}:done`, { status: 'canceled' })
  }
  cancelQueuedTurns(sessionId)

  for (const t of listTurns(sessionId)) {
    if (t.status === 'running') cancelTurn(t.id)
  }
  recomputeSessionStatus(sessionId)
  emitSession(sessionId)

  const worker = workers.get(sessionId)
  if (!worker) return Promise.resolve()
  return Promise.race([
    worker,
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ])
}

/** 删除会话：先取消队列与运行中 turn，再删除记录 */
export async function deleteSessionSafe(sessionId) {
  await cancelSessionQueue(sessionId)
  deleteSession(sessionId)
}

/** 启动对账：中断遗留 running，重算状态，拉起仍有排队的会话 */
export function initQueue() {
  markRunningTurnsInterrupted()
  for (const id of listAllSessionIds()) recomputeSessionStatus(id)
  for (const id of listSessionsWithQueuedTurns()) kick(id)
}
