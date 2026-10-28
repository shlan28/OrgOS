import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

export const DATA_DIR = process.env.ORG_OS_DATA_DIR || path.join(REPO_ROOT, 'server', 'data')
export const DEFAULT_WORKDIR = process.env.ORG_OS_WORKDIR || REPO_ROOT

fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS runtimes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'deepseek-official',
  base_url    TEXT NOT NULL DEFAULT '',
  models_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_account (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token        TEXT PRIMARY KEY,
  user_name    TEXT NOT NULL,
  permission   TEXT NOT NULL DEFAULT '成员',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS org_members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  permission  TEXT NOT NULL DEFAULT '成员',
  online      INTEGER NOT NULL DEFAULT 0,
  last_active TEXT NOT NULL DEFAULT '活跃于 刚刚',
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  TEXT NOT NULL,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS org_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_folders (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  members_json TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  permission  TEXT NOT NULL DEFAULT '',
  online      INTEGER NOT NULL DEFAULT 0,
  last_active TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT '进行中',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL DEFAULT 'deepseek-chat',
  provider      TEXT NOT NULL DEFAULT 'deepseek-official',
  permission    TEXT NOT NULL DEFAULT 'workspace-write',
  workdir       TEXT NOT NULL,
  config_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  dsh_session_id TEXT,
  status         TEXT NOT NULL DEFAULT 'idle',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_agent ON sessions(agent_id, created_at);

CREATE TABLE IF NOT EXISTS session_reads (
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_name     TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (session_id, user_name)
);

CREATE TABLE IF NOT EXISTS turns (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  user_content TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  error        TEXT,
  created_at   TEXT NOT NULL,
  ended_at     TEXT
);
CREATE INDEX IF NOT EXISTS turns_session ON turns(session_id, seq);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id    TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_turn ON events(turn_id, seq);

CREATE TABLE IF NOT EXISTS feishu_doc_sources (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  token          TEXT NOT NULL,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL DEFAULT '',
  auth           TEXT NOT NULL DEFAULT 'tenant',
  last_synced_at TEXT,
  last_status    TEXT NOT NULL DEFAULT '',
  last_error     TEXT,
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(project_id, kind, token)
);

CREATE TABLE IF NOT EXISTS feishu_docs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  source_id      TEXT NOT NULL REFERENCES feishu_doc_sources(id) ON DELETE CASCADE,
  external_token TEXT NOT NULL,
  external_type  TEXT NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL DEFAULT '',
  parent_path    TEXT NOT NULL DEFAULT '',
  parent_token   TEXT NOT NULL DEFAULT '',
  modified_at    TEXT,
  revision       TEXT NOT NULL DEFAULT '',
  size_bytes     INTEGER,
  sync_status    TEXT NOT NULL DEFAULT 'synced',
  sync_error     TEXT,
  last_synced_at TEXT NOT NULL,
  kb_state       TEXT NOT NULL DEFAULT 'off',
  kb_error       TEXT,
  kb_revision    TEXT,
  kb_fetched_at  TEXT,
  deleted_at     TEXT,
  UNIQUE(project_id, external_token)
);
CREATE INDEX IF NOT EXISTS feishu_docs_source ON feishu_docs(source_id, parent_path);

CREATE TABLE IF NOT EXISTS feishu_doc_contents (
  doc_id     TEXT PRIMARY KEY REFERENCES feishu_docs(id) ON DELETE CASCADE,
  revision   TEXT NOT NULL,
  format     TEXT NOT NULL DEFAULT 'markdown',
  content    TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feishu_sync_runs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  source_id   TEXT,
  trigger     TEXT NOT NULL DEFAULT 'manual',
  status      TEXT NOT NULL DEFAULT 'running',
  total       INTEGER NOT NULL DEFAULT 0,
  added       INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  doc_id          TEXT NOT NULL REFERENCES feishu_docs(id) ON DELETE CASCADE,
  revision        TEXT NOT NULL,
  ordinal         INTEGER NOT NULL,
  section_path    TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL,
  context         TEXT NOT NULL,
  char_count      INTEGER NOT NULL,
  content_hash    TEXT NOT NULL,
  embedding       BLOB,
  embedding_model TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kb_chunks_doc ON kb_chunks(doc_id, ordinal);
CREATE INDEX IF NOT EXISTS kb_chunks_project ON kb_chunks(project_id);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
  context,
  content='kb_chunks',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(rowid, context) VALUES (new.rowid, new.context);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, context) VALUES ('delete', old.rowid, old.context);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_au AFTER UPDATE OF context ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, context) VALUES ('delete', old.rowid, old.context);
  INSERT INTO kb_chunks_fts(rowid, context) VALUES (new.rowid, new.context);
END;

CREATE TABLE IF NOT EXISTS kb_index_runs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  doc_id      TEXT,
  trigger     TEXT NOT NULL DEFAULT 'manual',
  status      TEXT NOT NULL DEFAULT 'running',
  chunks      INTEGER NOT NULL DEFAULT 0,
  embedded    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

/* 记忆：Postgres 不是本项目的真相源，SQLite 里同样只存库、不落文件 */
CREATE TABLE IF NOT EXISTS memories (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT '手动',
  source_session_id TEXT,
  source_turn_id    TEXT,
  source_file_id    TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  importance        REAL NOT NULL DEFAULT 0.5,
  reflect_note      TEXT,
  dedupe_hash       TEXT,
  embedding         BLOB,
  embedding_model   TEXT NOT NULL DEFAULT '',
  expires_at        TEXT,
  last_used_at      TEXT,
  last_reflected_at TEXT,
  created_by        TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS memories_project_status ON memories(project_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS memories_dedupe
  ON memories(project_id, dedupe_hash)
  WHERE dedupe_hash IS NOT NULL AND status <> 'deleted';

CREATE TABLE IF NOT EXISTS memory_settings (
  project_id        TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  auto_collect      INTEGER NOT NULL DEFAULT 1,
  inject_memory     INTEGER NOT NULL DEFAULT 1,
  collect_rules     TEXT NOT NULL DEFAULT '',
  collect_every     INTEGER NOT NULL DEFAULT 5,
  retention_days    INTEGER NOT NULL DEFAULT 90,
  permanent         INTEGER NOT NULL DEFAULT 0,
  expire_policy     TEXT NOT NULL DEFAULT '自动归档',
  auto_reflect      INTEGER NOT NULL DEFAULT 0,
  reflect_frequency TEXT NOT NULL DEFAULT '每周',
  reflect_rules     TEXT NOT NULL DEFAULT '',
  last_retention_at TEXT,
  last_reflect_at   TEXT,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_events (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  memory_id    TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  actor        TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_events_memory ON memory_events(memory_id, created_at);
CREATE INDEX IF NOT EXISTS memory_events_project ON memory_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS memory_job_runs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  trigger     TEXT NOT NULL DEFAULT 'threshold',
  status      TEXT NOT NULL DEFAULT 'running',
  scanned     INTEGER NOT NULL DEFAULT 0,
  changed     INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL DEFAULT '{}',
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS memory_job_runs_project
  ON memory_job_runs(project_id, kind, started_at);
`)

export const nowISO = () => new Date().toISOString()
export const newId = (prefix) => `${prefix}_${crypto.randomUUID()}`

/** 兼容已有数据库：缺列时补列（node:sqlite 不支持 IF NOT EXISTS 加列） */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}
ensureColumn('agents', 'project_id', 'project_id TEXT')
ensureColumn('agents', 'runtime_id', 'runtime_id TEXT')
ensureColumn('sessions', 'project_id', 'project_id TEXT')
ensureColumn('sessions', 'external_ref', 'external_ref TEXT')
ensureColumn('sessions', 'created_by', "created_by TEXT DEFAULT ''")
ensureColumn('sessions', 'last_message_at', 'last_message_at TEXT')
ensureColumn('turns', 'user_name', "user_name TEXT DEFAULT ''")
ensureColumn('turns', 'agent_id', 'agent_id TEXT')
ensureColumn('turns', 'agent_name', "agent_name TEXT DEFAULT ''")
ensureColumn('turns', 'use_knowledge', 'use_knowledge INTEGER NOT NULL DEFAULT 0')
ensureColumn('turns', 'use_memory', 'use_memory INTEGER NOT NULL DEFAULT 1')
ensureColumn('sessions', 'memory_collect_cursor', 'memory_collect_cursor INTEGER NOT NULL DEFAULT 0')
ensureColumn('projects', 'start_date', 'start_date TEXT')
ensureColumn('projects', 'end_date', 'end_date TEXT')
ensureColumn('projects', 'folder_id', 'folder_id TEXT')
ensureColumn('projects', 'created_by', 'created_by TEXT')
ensureColumn('projects', 'deleted_at', 'deleted_at TEXT')
ensureColumn('projects', 'project_type', "project_type TEXT NOT NULL DEFAULT 'dev'")
ensureColumn('projects', 'workspace_mode', "workspace_mode TEXT NOT NULL DEFAULT 'serial'")
ensureColumn('project_folders', 'deleted_at', 'deleted_at TEXT')
ensureColumn('feishu_doc_sources', 'doc_type', "doc_type TEXT NOT NULL DEFAULT ''")
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS sessions_agent_ref
         ON sessions(agent_id, external_ref) WHERE external_ref IS NOT NULL`)

/** 历史 turn 的 seq 去重后建立唯一索引（并发发送依赖该索引） */
;(function ensureTurnSeqUnique() {
  const dupSessions = db.prepare(
    'SELECT session_id FROM turns GROUP BY session_id HAVING COUNT(*) <> COUNT(DISTINCT seq)',
  ).all()
  if (dupSessions.length > 0) {
    db.exec('BEGIN')
    try {
      for (const { session_id: sessionId } of dupSessions) {
        const rows = db.prepare(
          'SELECT id FROM turns WHERE session_id = ? ORDER BY seq ASC, created_at ASC, rowid ASC',
        ).all(sessionId)
        rows.forEach((r, i) => db.prepare('UPDATE turns SET seq = ? WHERE id = ?').run(-(i + 1), r.id))
        rows.forEach((r, i) => db.prepare('UPDATE turns SET seq = ? WHERE id = ?').run(i + 1, r.id))
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS turns_session_seq ON turns(session_id, seq)')
})()

const parseJSON = (raw, fallback) => {
  try { return JSON.parse(raw) } catch { return fallback }
}

/* ---------------- agents ---------------- */

/** agent 查询：附带运行时状态（是否存在 running 会话） */
const AGENT_SELECT = `
  SELECT a.*,
    (SELECT COUNT(*) FROM sessions s WHERE s.agent_id = a.id AND s.status = 'running') AS running_count,
    (SELECT s.title FROM sessions s WHERE s.agent_id = a.id AND s.status = 'running'
      ORDER BY s.updated_at DESC LIMIT 1) AS running_title,
    (SELECT COUNT(*) FROM sessions s WHERE s.agent_id = a.id) AS session_count
  FROM agents a`

const rowToAgent = (r) => ({
  id: r.id,
  name: r.name,
  role: r.role,
  model: r.model,
  provider: r.provider,
  permission: r.permission,
  workdir: r.workdir,
  projectId: r.project_id ?? null,
  runtimeId: r.runtime_id ?? null,
  /** 运行时派生：有 running 会话即「工作中」 */
  status: (r.running_count ?? 0) > 0 ? '工作中' : '空闲',
  currentTask: (r.running_count ?? 0) > 0 ? (r.running_title ?? '') : '',
  sessionCount: r.session_count ?? 0,
  config: parseJSON(r.config_json, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listAgents() {
  return db.prepare(`${AGENT_SELECT} ORDER BY a.created_at ASC`).all().map(rowToAgent)
}

export function getAgent(id) {
  const row = db.prepare(`${AGENT_SELECT} WHERE a.id = ?`).get(id)
  return row ? rowToAgent(row) : null
}

export function saveAgent(input) {
  const now = nowISO()
  const existing = input.id ? getAgent(input.id) : null
  const id = existing?.id ?? input.id ?? newId('agent')
  const agent = {
    id,
    name: (input.name ?? existing?.name ?? '').trim() || '未命名 Agent',
    role: (input.role ?? existing?.role ?? '').trim(),
    model: (input.model ?? existing?.model ?? 'deepseek-chat').trim(),
    provider: (input.provider ?? existing?.provider ?? 'deepseek-official').trim(),
    permission: input.permission ?? existing?.permission ?? 'workspace-write',
    workdir: (input.workdir ?? existing?.workdir ?? DEFAULT_WORKDIR).trim() || DEFAULT_WORKDIR,
    projectId: input.projectId === undefined ? (existing?.projectId ?? null) : (input.projectId || null),
    runtimeId: input.runtimeId === undefined ? (existing?.runtimeId ?? null) : (input.runtimeId || null),
    config: JSON.stringify(input.config ?? existing?.config ?? {}),
  }
  if (existing) {
    db.prepare(`UPDATE agents SET name=?, role=?, model=?, provider=?, permission=?, workdir=?, project_id=?, runtime_id=?, config_json=?, updated_at=? WHERE id=?`)
      .run(agent.name, agent.role, agent.model, agent.provider, agent.permission, agent.workdir, agent.projectId, agent.runtimeId, agent.config, now, id)
  } else {
    db.prepare(`INSERT INTO agents (id, name, role, model, provider, permission, workdir, project_id, runtime_id, config_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, agent.name, agent.role, agent.model, agent.provider, agent.permission, agent.workdir, agent.projectId, agent.runtimeId, agent.config, now, now)
  }
  return getAgent(id)
}

export function deleteAgent(id) {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
}

/** 前端整表同步：upsert 全部 + 删除不在列表中的 agent */
export function syncAgents(list) {
  const keep = new Set()
  db.exec('BEGIN')
  try {
    for (const item of list) {
      const saved = saveAgent(item)
      keep.add(saved.id)
    }
    for (const a of listAgents()) {
      if (!keep.has(a.id)) deleteAgent(a.id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return listAgents()
}

/* ---------------- sessions ---------------- */

const rowToSession = (r) => ({
  id: r.id,
  agentId: r.agent_id,
  projectId: r.project_id ?? null,
  externalRef: r.external_ref ?? null,
  title: r.title,
  dshSessionId: r.dsh_session_id,
  status: r.status,
  createdBy: r.created_by ?? '',
  lastMessageAt: r.last_message_at ?? null,
  unreadCount: r.unread_count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listSessions(agentId) {
  return db.prepare('SELECT * FROM sessions WHERE agent_id = ? ORDER BY created_at DESC').all(agentId).map(rowToSession)
}

export function getSession(id) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return row ? rowToSession(row) : null
}

export function createSession(agentId, title, projectId = null, externalRef = null, createdBy = '') {
  const id = newId('sess')
  const now = nowISO()
  db.prepare(`INSERT INTO sessions (id, agent_id, project_id, external_ref, title, status, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, agentId, projectId || null, externalRef || null, title || '新会话', 'idle', createdBy || '', now, now)
  return getSession(id)
}

export function findSessionByRef(agentId, externalRef) {
  if (!externalRef) return null
  const row = db.prepare('SELECT * FROM sessions WHERE agent_id = ? AND external_ref = ?').get(agentId, externalRef)
  return row ? rowToSession(row) : null
}

export function listProjectSessions(projectId, userName = '') {
  return db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM turns t
        WHERE t.session_id = s.id AND t.seq > COALESCE(r.last_read_seq, 0)) AS unread_count
    FROM sessions s
    LEFT JOIN session_reads r ON r.session_id = s.id AND r.user_name = ?
    WHERE s.project_id = ?
    ORDER BY CASE s.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
             COALESCE(s.last_message_at, s.created_at) DESC
  `).all(userName, projectId).map(rowToSession)
}

/** 标记会话已读到指定 seq（缺省读到最新） */
export function markSessionRead(sessionId, userName, uptoSeq) {
  const maxSeq = uptoSeq == null
    ? db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM turns WHERE session_id = ?').get(sessionId).s
    : Number(uptoSeq)
  db.prepare(`
    INSERT INTO session_reads (session_id, user_name, last_read_seq, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, user_name) DO UPDATE SET
      last_read_seq = MAX(session_reads.last_read_seq, excluded.last_read_seq),
      updated_at = excluded.updated_at
  `).run(sessionId, userName, maxSeq, nowISO())
  return maxSeq
}

/** 新建项目会话：服务端生成不重复标题（事务内） */
export function createProjectSession(projectId, agentId, createdBy = '') {
  const id = newId('sess')
  const now = nowISO()
  db.exec('BEGIN IMMEDIATE')
  try {
    const rows = db.prepare('SELECT title FROM sessions WHERE project_id = ?').all(projectId)
    let maxNo = 0
    for (const { title } of rows) {
      const m = /^新对话\s*(\d+)$/.exec(title || '')
      if (m) maxNo = Math.max(maxNo, Number(m[1]))
    }
    const title = `新对话 ${maxNo + 1}`
    db.prepare(`INSERT INTO sessions (id, agent_id, project_id, title, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'idle', ?, ?, ?)`)
      .run(id, agentId, projectId, title, createdBy || '', now, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return getSession(id)
}

/** 按 turn 状态派生会话状态并写回 */
export function recomputeSessionStatus(sessionId) {
  const running = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE session_id = ? AND status = 'running'").get(sessionId).c
  const queued = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE session_id = ? AND status = 'queued'").get(sessionId).c
  const status = running > 0 ? 'running' : queued > 0 ? 'queued' : 'idle'
  db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, nowISO(), sessionId)
  return status
}

export function updateSessionDshId(id, dshSessionId) {
  db.prepare('UPDATE sessions SET dsh_session_id = ?, updated_at = ? WHERE id = ?').run(dshSessionId, nowISO(), id)
}

export function updateSessionStatus(id, status) {
  db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, nowISO(), id)
}

export function updateSessionTitle(id, title) {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, nowISO(), id)
}

export function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

/* ---------------- turns & events ---------------- */

const rowToTurn = (r) => ({
  id: r.id,
  sessionId: r.session_id,
  seq: r.seq,
  userContent: r.user_content,
  userName: r.user_name ?? '',
  agentId: r.agent_id ?? null,
  agentName: r.agent_name ?? '',
  status: r.status,
  error: r.error,
  useKnowledge: Boolean(r.use_knowledge),
  useMemory: r.use_memory !== 0,
  createdAt: r.created_at,
  endedAt: r.ended_at,
})

/** 入队：事务内生成 seq（唯一索引兜底），并刷新会话最后活动时间 */
export function enqueueTurn(sessionId, content, userName = '', useKnowledge = false, useMemory = true) {
  const id = newId('turn')
  const now = nowISO()
  db.exec('BEGIN IMMEDIATE')
  try {
    const seqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM turns WHERE session_id = ?').get(sessionId)
    db.prepare(`INSERT INTO turns (id, session_id, seq, user_content, user_name, status, use_knowledge, use_memory, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, sessionId, seqRow.s, content, userName, 'queued', useKnowledge ? 1 : 0, useMemory ? 1 : 0, now)
    db.prepare('UPDATE sessions SET last_message_at = ?, updated_at = ? WHERE id = ?').run(now, now, sessionId)
    recomputeSessionStatus(sessionId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return getTurn(id)
}

export function nextQueuedTurn(sessionId) {
  const row = db.prepare(`SELECT * FROM turns WHERE session_id = ? AND status = 'queued'
                          ORDER BY seq ASC LIMIT 1`).get(sessionId)
  return row ? rowToTurn(row) : null
}

export function countQueuedAhead(sessionId, seq) {
  return db.prepare(`SELECT COUNT(*) AS c FROM turns
                     WHERE session_id = ? AND status IN ('queued', 'running') AND seq < ?`)
    .get(sessionId, seq).c
}

export function markTurnRunning(id, agentId, agentName) {
  db.prepare('UPDATE turns SET status = ?, agent_id = ?, agent_name = ? WHERE id = ?')
    .run('running', agentId ?? null, agentName ?? '', id)
}

export function markTurnCanceled(id) {
  db.prepare(`UPDATE turns SET status = 'canceled', ended_at = ? WHERE id = ? AND status IN ('queued', 'running')`)
    .run(nowISO(), id)
}

export function cancelQueuedTurns(sessionId) {
  db.prepare(`UPDATE turns SET status = 'canceled', ended_at = ?
              WHERE session_id = ? AND status = 'queued'`).run(nowISO(), sessionId)
}

export function markRunningTurnsInterrupted() {
  db.prepare(`UPDATE turns SET status = 'error', error = ?, ended_at = ?
              WHERE status = 'running'`).run('服务重启中断', nowISO())
}

export function listSessionsWithQueuedTurns() {
  return db.prepare("SELECT DISTINCT session_id AS id FROM turns WHERE status = 'queued'").all().map((r) => r.id)
}

export function listAllSessionIds() {
  return db.prepare('SELECT id FROM sessions').all().map((r) => r.id)
}

export function getTurn(id) {
  const row = db.prepare('SELECT * FROM turns WHERE id = ?').get(id)
  return row ? rowToTurn(row) : null
}

export function listTurns(sessionId) {
  return db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY seq ASC').all(sessionId).map(rowToTurn)
}

/** 分页取 turn（从新到旧取一页，返回时按 seq 升序；hasMore 表示还有更早的） */
export function listTurnsPage(sessionId, beforeSeq = null, limit = 50) {
  const size = Math.max(1, Math.min(200, Number(limit) || 50))
  const rows = beforeSeq == null
    ? db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY seq DESC LIMIT ?')
      .all(sessionId, size + 1)
    : db.prepare('SELECT * FROM turns WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?')
      .all(sessionId, Number(beforeSeq), size + 1)
  const hasMore = rows.length > size
  return {
    turns: rows.slice(0, size).reverse().map(rowToTurn),
    hasMore,
  }
}

/** 批量取每个 turn 的最后一条 final 事件（避免 N+1） */
export function listFinalsForTurns(turnIds) {
  const map = new Map()
  if (!turnIds.length) return map
  const placeholders = turnIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT turn_id, payload, created_at, seq FROM events
                           WHERE type = 'final' AND turn_id IN (${placeholders})
                           ORDER BY seq ASC`).all(...turnIds)
  for (const r of rows) {
    const payload = parseJSON(r.payload, {})
    map.set(r.turn_id, { text: payload.text || '', at: r.created_at })
  }
  return map
}

export function finishTurn(id, status, error) {
  db.prepare('UPDATE turns SET status = ?, error = ?, ended_at = ? WHERE id = ?').run(status, error ?? null, nowISO(), id)
}

export function appendEvent(turnId, sessionId, type, payload) {
  const seqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM events WHERE turn_id = ?').get(turnId)
  db.prepare('INSERT INTO events (turn_id, session_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(turnId, sessionId, seqRow.s, type, JSON.stringify(payload), nowISO())
  return seqRow.s
}

export function listEvents(turnId) {
  return db.prepare('SELECT * FROM events WHERE turn_id = ? ORDER BY seq ASC').all(turnId)
    .map((r) => ({ seq: r.seq, type: r.type, payload: parseJSON(r.payload, {}) }))
}

/** 会话内全部事件（按 turn.seq → event.seq 排序，用于 CLI 历史回放） */
export function listSessionEvents(sessionId, turnsLimit = 50) {
  const limit = Number(turnsLimit)
  let filter = ''
  const params = [sessionId]
  if (Number.isFinite(limit) && limit > 0) {
    const ids = db.prepare('SELECT id FROM turns WHERE session_id = ? ORDER BY seq DESC LIMIT ?')
      .all(sessionId, limit).map((r) => r.id)
    if (ids.length === 0) return []
    filter = `AND e.turn_id IN (${ids.map(() => '?').join(',')})`
    params.push(...ids)
  }
  return db.prepare(`
    SELECT e.turn_id, e.seq, e.type, e.payload, e.created_at, t.seq AS turn_seq
    FROM events e JOIN turns t ON t.id = e.turn_id
    WHERE e.session_id = ? ${filter}
    ORDER BY t.seq ASC, e.seq ASC
  `).all(...params).map((r) => ({
    turnId: r.turn_id,
    turnSeq: r.turn_seq,
    seq: r.seq,
    type: r.type,
    payload: parseJSON(r.payload, {}),
    at: r.created_at,
  }))
}

/* ---------------- secrets ---------------- */

const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json')

export function readSecrets() {
  try { return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) } catch { return {} }
}

export function writeSecrets(next) {
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
  try { fs.chmodSync(SECRETS_FILE, 0o600) } catch { /* ignore */ }
}

/** 运行时 API Key：优先 runtimeKeys[<id>]，默认运行时兼容旧的 deepseekApiKey */
export function runtimeKey(runtimeId) {
  const secrets = readSecrets()
  const perRuntime = secrets.runtimeKeys?.[runtimeId]
  if (perRuntime) return perRuntime
  if (runtimeId === 'rt_default' && secrets.deepseekApiKey) return secrets.deepseekApiKey
  return ''
}

export function setRuntimeKey(runtimeId, key) {
  const secrets = { ...readSecrets() }
  const runtimeKeys = { ...(secrets.runtimeKeys || {}) }
  const value = (key || '').trim()
  if (value) runtimeKeys[runtimeId] = value
  else delete runtimeKeys[runtimeId]
  secrets.runtimeKeys = runtimeKeys
  // 默认运行时同步写回旧字段，兼容已有配置
  if (runtimeId === 'rt_default') {
    if (value) secrets.deepseekApiKey = value
    else delete secrets.deepseekApiKey
  }
  writeSecrets(secrets)
}

/* ---------------- runtimes ---------------- */

const rowToRuntime = (r) => ({
  id: r.id,
  name: r.name,
  provider: r.provider,
  baseUrl: r.base_url,
  models: parseJSON(r.models_json, []),
  hasKey: Boolean(runtimeKey(r.id)),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listRuntimes() {
  return db.prepare('SELECT * FROM runtimes ORDER BY created_at ASC').all().map(rowToRuntime)
}

export function getRuntime(id) {
  const row = db.prepare('SELECT * FROM runtimes WHERE id = ?').get(id)
  return row ? rowToRuntime(row) : null
}

export function saveRuntime(input) {
  const now = nowISO()
  const existing = input.id ? getRuntime(input.id) : null
  const id = existing?.id ?? input.id ?? newId('rt')
  const name = (input.name ?? existing?.name ?? '').trim() || '未命名运行时'
  const provider = (input.provider ?? existing?.provider ?? 'deepseek-official').trim()
  const baseUrl = (input.baseUrl ?? existing?.baseUrl ?? '').trim()
  const models = Array.isArray(input.models)
    ? Array.from(new Set(input.models.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim())))
    : (existing?.models ?? [])
  if (existing) {
    db.prepare('UPDATE runtimes SET name=?, provider=?, base_url=?, models_json=?, updated_at=? WHERE id=?')
      .run(name, provider, baseUrl, JSON.stringify(models), now, id)
  } else {
    db.prepare('INSERT INTO runtimes (id, name, provider, base_url, models_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, provider, baseUrl, JSON.stringify(models), now, now)
  }
  return getRuntime(id)
}

/** 删除运行时：使用它的 Agent 解绑（不会删 Agent） */
export function deleteRuntime(id) {
  db.prepare('UPDATE agents SET runtime_id = NULL WHERE runtime_id = ?').run(id)
  db.prepare('DELETE FROM runtimes WHERE id = ?').run(id)
}

/* ---------------- projects ---------------- */

const rowToProject = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  status: r.status,
  type: r.project_type === 'nondev' ? 'nondev' : 'dev',
  workspaceMode: ['none', 'serial', 'worktree'].includes(r.workspace_mode) ? r.workspace_mode : 'none',
  startDate: r.start_date || '',
  endDate: r.end_date || '',
  folderId: r.folder_id || null,
  createdBy: r.created_by || '',
  agentCount: r.agent_count ?? 0,
  sessionCount: r.session_count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const PROJECT_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM agents a WHERE a.project_id = p.id) AS agent_count,
    (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) AS session_count
  FROM projects p`

const rowToProjectMember = (r) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  role: r.role,
  permission: r.permission,
  online: Boolean(r.online),
  lastActive: r.last_active,
})

export function listProjectMembers(projectId) {
  return db.prepare('SELECT * FROM project_members WHERE project_id = ? ORDER BY rowid ASC')
    .all(projectId)
    .map(rowToProjectMember)
}

export function listProjects() {
  return db.prepare(`${PROJECT_SELECT} WHERE p.deleted_at IS NULL ORDER BY p.created_at ASC`).all()
    .map((r) => ({ ...rowToProject(r), members: listProjectMembers(r.id) }))
}

export function getProject(id) {
  const row = db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`).get(id)
  if (!row) return null
  return { ...rowToProject(row), members: listProjectMembers(id) }
}

export function saveProject(input) {
  const now = nowISO()
  const existing = input.id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(input.id) : null
  const id = existing?.id ?? input.id ?? newId('proj')
  const name = (input.name ?? existing?.name ?? '').trim() || '未命名项目'
  const description = (input.description ?? existing?.description ?? '').trim()
  const status = input.status ?? existing?.status ?? '进行中'
  const startDate = input.startDate === undefined ? (existing?.start_date || '') : String(input.startDate || '')
  const endDate = input.endDate === undefined ? (existing?.end_date || '') : String(input.endDate || '')
  const folderId = input.folderId === undefined ? (existing?.folder_id || null) : (input.folderId || null)
  const createdBy = input.createdBy === undefined ? (existing?.created_by || '') : String(input.createdBy || '')
  const type = existing
    ? (existing.project_type === 'nondev' ? 'nondev' : 'dev')
    : (input.type === 'nondev' ? 'nondev' : 'dev')
  const workspaceMode = existing
    ? (existing.workspace_mode || 'none')
    : (['none', 'serial', 'worktree'].includes(input.workspaceMode)
        ? input.workspaceMode
        : (type === 'dev' ? 'serial' : 'none'))

  if (existing) {
    db.prepare(`UPDATE projects SET name=?, description=?, status=?, start_date=?, end_date=?, folder_id=?, created_by=?, updated_at=? WHERE id=?`)
      .run(name, description, status, startDate, endDate, folderId, createdBy, now, id)
  } else {
    db.prepare(`INSERT INTO projects (id, name, description, status, start_date, end_date, folder_id, created_by, project_type, workspace_mode, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, description, status, startDate, endDate, folderId, createdBy, type, workspaceMode, now, now)
  }
  return getProject(id)
}

/** 项目成员整体替换（编辑项目弹窗保存时使用） */
export function replaceProjectMembers(projectId, members) {
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId)
    for (const member of members || []) {
      const name = String(member?.name ?? '').trim()
      if (!name) continue
      db.prepare(`INSERT INTO project_members (id, project_id, name, role, permission, online, last_active, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          newId('pm'),
          projectId,
          name,
          String(member.role ?? '').trim(),
          String(member.permission ?? '').trim(),
          member.online ? 1 : 0,
          String(member.lastActive ?? '活跃于 刚刚'),
          nowISO(),
        )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return listProjectMembers(projectId)
}

/** 编辑项目：元信息 + 成员整体替换 */
export function saveProjectWithMembers(id, input) {
  saveProject({ ...input, id })
  if (Array.isArray(input.members)) replaceProjectMembers(id, input.members)
  return getProject(id)
}

/** 删除项目（软删除：打删除标记，项目成员 / 会话 / Agent 绑定等数据保留） */
export function deleteProject(id) {
  const now = nowISO()
  db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

export function listProjectAgents(projectId) {
  return db.prepare(`${AGENT_SELECT} WHERE a.project_id = ? ORDER BY a.created_at ASC`).all(projectId).map(rowToAgent)
}

/* ---------------- project folders ---------------- */

const rowToProjectFolder = (r) => ({
  id: r.id,
  name: r.name,
  members: parseJSON(r.members_json, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listProjectFolders() {
  return db.prepare('SELECT * FROM project_folders WHERE deleted_at IS NULL ORDER BY created_at ASC').all().map(rowToProjectFolder)
}

export function saveProjectFolder(input) {
  const now = nowISO()
  const existing = input.id ? db.prepare('SELECT * FROM project_folders WHERE id = ?').get(input.id) : null
  const id = existing?.id ?? input.id ?? newId('pf')
  const name = (input.name ?? existing?.name ?? '').trim() || '未命名文件夹'
  const members = Array.isArray(input.members) ? input.members : parseJSON(existing?.members_json, [])
  if (existing) {
    db.prepare('UPDATE project_folders SET name=?, members_json=?, updated_at=? WHERE id=?')
      .run(name, JSON.stringify(members), now, id)
  } else {
    db.prepare('INSERT INTO project_folders (id, name, members_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, JSON.stringify(members), now, now)
  }
  const row = db.prepare('SELECT * FROM project_folders WHERE id = ?').get(id)
  return rowToProjectFolder(row)
}

/** 删除文件夹（软删除：打删除标记；内部项目移至未分组） */
export function deleteProjectFolder(id) {
  const now = nowISO()
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE projects SET folder_id = NULL, updated_at = ? WHERE folder_id = ?').run(now, id)
    db.prepare('UPDATE project_folders SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/* ---------------- feishu doc sync ---------------- */

const rowToDocSource = (r) => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  token: r.token,
  name: r.name,
  url: r.url,
  auth: r.auth,
  docType: r.doc_type || '',
  lastSyncedAt: r.last_synced_at,
  lastStatus: r.last_status,
  lastError: r.last_error,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listDocSources(projectId) {
  return db.prepare('SELECT * FROM feishu_doc_sources WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId)
    .map(rowToDocSource)
}

export function getDocSource(id) {
  const row = db.prepare('SELECT * FROM feishu_doc_sources WHERE id = ?').get(id)
  return row ? rowToDocSource(row) : null
}

export function findDocSource(projectId, kind, token) {
  const row = db.prepare('SELECT * FROM feishu_doc_sources WHERE project_id = ? AND kind = ? AND token = ?')
    .get(projectId, kind, token)
  return row ? rowToDocSource(row) : null
}

export function saveDocSource(input) {
  const now = nowISO()
  const projectId = String(input.projectId || '')
  const kind = input.kind === 'wiki_space' ? 'wiki_space' : input.kind === 'doc' ? 'doc' : 'folder'
  const token = String(input.token || '').trim()
  const name = String(input.name || '').trim()
    || (kind === 'wiki_space' ? '知识库空间' : kind === 'doc' ? '单篇文档' : '飞书文件夹')
  const url = String(input.url || '').trim()
  const auth = input.auth === 'user' ? 'user' : 'tenant'
  const docType = String(input.docType || '').trim()
  const existing = input.id
    ? db.prepare('SELECT * FROM feishu_doc_sources WHERE id = ?').get(input.id)
    : findDocSource(projectId, kind, token)

  if (existing) {
    db.prepare('UPDATE feishu_doc_sources SET name=?, url=?, auth=?, doc_type=?, updated_at=? WHERE id=?')
      .run(name, url, auth, docType, now, existing.id)
    return getDocSource(existing.id)
  }
  const id = newId('fds')
  db.prepare(`INSERT INTO feishu_doc_sources
    (id, project_id, kind, token, name, url, auth, doc_type, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, kind, token, name, url, auth, docType, String(input.createdBy || ''), now, now)
  return getDocSource(id)
}

export function updateDocSourceSync(id, status, error = null) {
  db.prepare('UPDATE feishu_doc_sources SET last_synced_at=?, last_status=?, last_error=?, updated_at=? WHERE id=?')
    .run(nowISO(), status, error, nowISO(), id)
}

/** 删除同步源：级联删除文档、快照与正文（外键 ON DELETE CASCADE） */
export function deleteDocSource(id) {
  db.prepare('DELETE FROM feishu_doc_sources WHERE id = ?').run(id)
}

const rowToFeishuDoc = (r) => ({
  id: r.id,
  projectId: r.project_id,
  sourceId: r.source_id,
  externalToken: r.external_token,
  externalType: r.external_type,
  title: r.title,
  url: r.url,
  parentPath: r.parent_path,
  parentToken: r.parent_token,
  modifiedAt: r.modified_at,
  revision: r.revision,
  sizeBytes: r.size_bytes,
  syncStatus: r.sync_status,
  syncError: r.sync_error,
  lastSyncedAt: r.last_synced_at,
  kbState: r.kb_state,
  kbError: r.kb_error,
  kbRevision: r.kb_revision,
  kbFetchedAt: r.kb_fetched_at,
  deletedAt: r.deleted_at,
  /** 快照落后于飞书当前版本 → 前端显示「待更新」 */
  stale: Boolean(r.kb_revision && r.revision && r.kb_revision !== r.revision),
})

export function listFeishuDocs(projectId, { sourceId = '', includeDeleted = false } = {}) {
  const where = ['project_id = ?']
  const args = [projectId]
  if (sourceId) { where.push('source_id = ?'); args.push(sourceId) }
  if (!includeDeleted) where.push('deleted_at IS NULL')
  return db.prepare(`SELECT * FROM feishu_docs WHERE ${where.join(' AND ')} ORDER BY parent_path ASC, title ASC`)
    .all(...args)
    .map(rowToFeishuDoc)
}

export function getFeishuDoc(id) {
  const row = db.prepare('SELECT * FROM feishu_docs WHERE id = ?').get(id)
  return row ? rowToFeishuDoc(row) : null
}

export function getFeishuDocByExternal(projectId, externalToken) {
  const row = db.prepare('SELECT * FROM feishu_docs WHERE project_id = ? AND external_token = ?')
    .get(projectId, externalToken)
  return row ? rowToFeishuDoc(row) : null
}

/**
 * 同步时写入单篇文档。返回 created（是否新增）。
 * revision 变化时不动 kb_revision —— 让「快照待更新」由 stale 判定出来。
 */
export function upsertFeishuDoc(input) {
  const now = nowISO()
  const existing = getFeishuDocByExternal(input.projectId, input.externalToken)

  if (existing) {
    db.prepare(`UPDATE feishu_docs SET
        source_id=?, external_type=?, title=?, url=?, parent_path=?, parent_token=?,
        modified_at=?, revision=?, size_bytes=?, sync_status='synced', sync_error=NULL,
        last_synced_at=?, deleted_at=NULL
      WHERE id=?`)
      .run(
        input.sourceId, input.externalType, input.title, input.url || '',
        input.parentPath || '', input.parentToken || '', input.modifiedAt || null,
        input.revision || '', input.sizeBytes ?? null, now, existing.id,
      )
    return { doc: getFeishuDoc(existing.id), created: false }
  }

  const id = newId('fdoc')
  db.prepare(`INSERT INTO feishu_docs
    (id, project_id, source_id, external_token, external_type, title, url, parent_path, parent_token,
     modified_at, revision, size_bytes, sync_status, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)`)
    .run(
      id, input.projectId, input.sourceId, input.externalToken, input.externalType, input.title,
      input.url || '', input.parentPath || '', input.parentToken || '', input.modifiedAt || null,
      input.revision || '', input.sizeBytes ?? null, now,
    )
  return { doc: getFeishuDoc(id), created: true }
}

/** 本轮未出现的文档：软删 + 清空知识库收录与快照 */
export function markFeishuDocsMissing(sourceId, keepTokens) {
  const keep = new Set(keepTokens)
  const rows = db.prepare('SELECT id, external_token FROM feishu_docs WHERE source_id = ? AND deleted_at IS NULL')
    .all(sourceId)
  const removed = rows.filter((r) => !keep.has(r.external_token))
  if (removed.length === 0) return 0
  const now = nowISO()
  const mark = db.prepare(`UPDATE feishu_docs SET deleted_at=?, sync_status='deleted', kb_state='off', kb_error=NULL WHERE id=?`)
  const dropContent = db.prepare('DELETE FROM feishu_doc_contents WHERE doc_id = ?')
  db.exec('BEGIN')
  try {
    for (const r of removed) {
      mark.run(now, r.id)
      dropContent.run(r.id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return removed.length
}

export function setFeishuDocKb(id, patch) {
  const fields = []
  const args = []
  const map = {
    kbState: 'kb_state',
    kbError: 'kb_error',
    kbRevision: 'kb_revision',
    kbFetchedAt: 'kb_fetched_at',
    syncError: 'sync_error',
    syncStatus: 'sync_status',
  }
  for (const [key, column] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      fields.push(`${column}=?`)
      args.push(patch[key] ?? null)
    }
  }
  if (fields.length === 0) return getFeishuDoc(id)
  args.push(id)
  db.prepare(`UPDATE feishu_docs SET ${fields.join(', ')} WHERE id=?`).run(...args)
  return getFeishuDoc(id)
}

export function listFeishuDocsByKb(projectId) {
  return db.prepare(`SELECT * FROM feishu_docs
      WHERE project_id = ? AND deleted_at IS NULL AND kb_state != 'off'
      ORDER BY parent_path ASC, title ASC`).all(projectId).map(rowToFeishuDoc)
}

export function getFeishuDocContent(docId) {
  const row = db.prepare('SELECT * FROM feishu_doc_contents WHERE doc_id = ?').get(docId)
  if (!row) return null
  return {
    docId: row.doc_id,
    revision: row.revision,
    format: row.format,
    content: row.content,
    charCount: row.char_count,
    fetchedAt: row.fetched_at,
  }
}

export function saveFeishuDocContent(docId, { revision, format = 'markdown', content }) {
  const now = nowISO()
  db.prepare(`INSERT INTO feishu_doc_contents (doc_id, revision, format, content, char_count, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        revision=excluded.revision, format=excluded.format, content=excluded.content,
        char_count=excluded.char_count, fetched_at=excluded.fetched_at`)
    .run(docId, revision || '', format, content, content.length, now)
  return now
}

export function deleteFeishuDocContent(docId) {
  db.prepare('DELETE FROM feishu_doc_contents WHERE doc_id = ?').run(docId)
}

export function createSyncRun(projectId, sourceId = null, trigger = 'manual') {
  const id = newId('frun')
  db.prepare(`INSERT INTO feishu_sync_runs (id, project_id, source_id, trigger, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)`)
    .run(id, projectId, sourceId, trigger, nowISO())
  return id
}

export function updateSyncRun(id, patch) {
  const fields = []
  const args = []
  const map = {
    status: 'status', total: 'total', added: 'added', updated: 'updated',
    removed: 'removed', failed: 'failed', error: 'error', finishedAt: 'finished_at',
  }
  for (const [key, column] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      fields.push(`${column}=?`)
      args.push(patch[key] ?? null)
    }
  }
  if (fields.length === 0) return
  args.push(id)
  db.prepare(`UPDATE feishu_sync_runs SET ${fields.join(', ')} WHERE id=?`).run(...args)
}

export function getSyncRun(id) {
  const row = db.prepare('SELECT * FROM feishu_sync_runs WHERE id = ?').get(id)
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    trigger: row.trigger,
    status: row.status,
    total: row.total,
    added: row.added,
    updated: row.updated,
    removed: row.removed,
    failed: row.failed,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export function latestSyncRun(projectId) {
  const row = db.prepare('SELECT id FROM feishu_sync_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(projectId)
  return row ? getSyncRun(row.id) : null
}

/* ---------------- knowledge base ---------------- */

const rowToChunk = (r) => ({
  id: r.id,
  projectId: r.project_id,
  docId: r.doc_id,
  revision: r.revision,
  ordinal: r.ordinal,
  sectionPath: r.section_path,
  content: r.content,
  context: r.context,
  charCount: r.char_count,
  contentHash: r.content_hash,
  embedding: r.embedding,
  embeddingModel: r.embedding_model,
  createdAt: r.created_at,
})

export function listChunksByDoc(docId) {
  return db.prepare('SELECT * FROM kb_chunks WHERE doc_id = ? ORDER BY ordinal ASC').all(docId).map(rowToChunk)
}

export function listChunksPage(docId, limit = 50, offset = 0) {
  return db.prepare('SELECT * FROM kb_chunks WHERE doc_id = ? ORDER BY ordinal ASC LIMIT ? OFFSET ?')
    .all(docId, limit, offset)
    .map(rowToChunk)
}

export function insertChunk(chunk) {
  db.prepare(`INSERT INTO kb_chunks
      (id, project_id, doc_id, revision, ordinal, section_path, content, context, char_count,
       content_hash, embedding, embedding_model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      chunk.id, chunk.projectId, chunk.docId, chunk.revision, chunk.ordinal,
      chunk.sectionPath || '', chunk.content, chunk.context, chunk.content.length,
      chunk.contentHash, chunk.embedding ?? null, chunk.embeddingModel || '', nowISO(),
    )
}

export function deleteChunksByIds(ids) {
  if (!ids || ids.length === 0) return
  const stmt = db.prepare('DELETE FROM kb_chunks WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const id of ids) stmt.run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function deleteChunksByDoc(docId) {
  db.prepare('DELETE FROM kb_chunks WHERE doc_id = ?').run(docId)
}

export function setChunkEmbedding(id, buffer, model) {
  db.prepare('UPDATE kb_chunks SET embedding = ?, embedding_model = ? WHERE id = ?').run(buffer, model, id)
}

/** 需要嵌入的片段（无向量或模型不一致） */
export function listChunksToEmbed(projectId, model, limit = 200) {
  return db.prepare(`SELECT * FROM kb_chunks
      WHERE project_id = ? AND (embedding IS NULL OR embedding_model != ?)
      ORDER BY created_at ASC LIMIT ?`).all(projectId, model, limit).map(rowToChunk)
}

/**
 * 可用于检索的向量：只取当前嵌入模型写的那批。
 * 换模型后旧向量空间不同，混在一起算余弦是静默错误，必须隔离。
 */
export function listChunksWithEmbeddings(projectId, model = '') {
  if (!model) return []
  return db.prepare(`SELECT id, doc_id, ordinal, section_path, content, embedding
      FROM kb_chunks WHERE project_id = ? AND embedding IS NOT NULL AND embedding_model = ?`)
    .all(projectId, model)
}

/** FTS5 检索：match 已由调用方拼好 */
export function searchChunksFts(projectId, match, limit = 40) {
  return db.prepare(`SELECT c.*, bm25(kb_chunks_fts) AS rank
      FROM kb_chunks_fts
      JOIN kb_chunks c ON c.rowid = kb_chunks_fts.rowid
      WHERE kb_chunks_fts MATCH ? AND c.project_id = ?
      ORDER BY rank ASC LIMIT ?`).all(match, projectId, limit)
}

/** 短查询兜底：LIKE 扫描（片段量级有限，可接受） */
export function searchChunksLike(projectId, keyword, limit = 40) {
  const escaped = keyword.replace(/[\\%_]/g, (m) => `\\${m}`)
  return db.prepare(`SELECT * FROM kb_chunks
      WHERE project_id = ? AND content LIKE ? ESCAPE '\\'
      LIMIT 500`).all(projectId, `%${escaped}%`).slice(0, limit)
}

/** 相邻片段（父文档回填用） */
export function listSiblingChunks(docId, ordinal, radius = 1) {
  return db.prepare('SELECT * FROM kb_chunks WHERE doc_id = ? AND ordinal BETWEEN ? AND ? ORDER BY ordinal ASC')
    .all(docId, ordinal - radius, ordinal + radius)
    .map(rowToChunk)
}

export function getChunkStats(projectId, model = '') {
  const row = db.prepare(`SELECT COUNT(*) AS chunks,
      COUNT(DISTINCT doc_id) AS docs,
      SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS embedded
    FROM kb_chunks WHERE project_id = ?`).get(projectId)
  const current = model
    ? db.prepare('SELECT COUNT(*) AS n FROM kb_chunks WHERE project_id = ? AND embedding_model = ?')
      .get(projectId, model).n
    : 0
  const embedded = Number(row?.embedded || 0)
  return {
    chunks: Number(row?.chunks || 0),
    docs: Number(row?.docs || 0),
    embedded,
    /** 当前模型已向量化的片段数 */
    embeddedCurrent: Number(current || 0),
    /** 有向量但属于旧模型的片段数（重建索引时会被重嵌） */
    embeddingStale: Math.max(0, embedded - Number(current || 0)),
  }
}

export function createKbRun(projectId, docId = null, trigger = 'manual') {
  const id = newId('kbq')
  db.prepare(`INSERT INTO kb_index_runs (id, project_id, doc_id, trigger, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)`).run(id, projectId, docId, trigger, nowISO())
  return id
}

export function updateKbRun(id, patch) {
  const map = { status: 'status', chunks: 'chunks', embedded: 'embedded', error: 'error', finishedAt: 'finished_at' }
  const fields = []
  const args = []
  for (const [key, column] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      fields.push(`${column}=?`)
      args.push(patch[key] ?? null)
    }
  }
  if (fields.length === 0) return
  args.push(id)
  db.prepare(`UPDATE kb_index_runs SET ${fields.join(', ')} WHERE id=?`).run(...args)
}

export function getKbRun(id) {
  const row = db.prepare('SELECT * FROM kb_index_runs WHERE id = ?').get(id)
  if (!row) return null
  return {
    id: row.id, projectId: row.project_id, docId: row.doc_id, trigger: row.trigger,
    status: row.status, chunks: row.chunks, embedded: row.embedded, error: row.error,
    startedAt: row.started_at, finishedAt: row.finished_at,
  }
}

export function latestKbRun(projectId) {
  const row = db.prepare('SELECT id FROM kb_index_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1').get(projectId)
  return row ? getKbRun(row.id) : null
}

/* —— 检索配置（org_settings + secrets） —— */

export function getKbConfig() {
  const secrets = readSecrets()
  return {
    baseUrl: getOrgSetting('kb_embedding_base_url', ''),
    model: getOrgSetting('kb_embedding_model', ''),
    dim: Number(getOrgSetting('kb_embedding_dim', '0')) || 0,
    glossary: getOrgSetting('kb_glossary', ''),
    /** 图片转写（OCR）用的视觉模型，留空则图片无法收录 */
    visionModel: getOrgSetting('kb_vision_model', ''),
    /** 重排用的对话模型，留空则不重排 */
    rerankModel: getOrgSetting('kb_rerank_model', ''),
    hasKey: Boolean(secrets.kbEmbeddingKey),
  }
}

export function setKbConfig(input) {
  if (typeof input.baseUrl === 'string') setOrgSetting('kb_embedding_base_url', input.baseUrl.trim())
  if (typeof input.model === 'string') setOrgSetting('kb_embedding_model', input.model.trim())
  if (input.dim !== undefined) setOrgSetting('kb_embedding_dim', String(Number(input.dim) || 0))
  if (typeof input.glossary === 'string') setOrgSetting('kb_glossary', input.glossary)
  if (typeof input.visionModel === 'string') setOrgSetting('kb_vision_model', input.visionModel.trim())
  if (typeof input.rerankModel === 'string') setOrgSetting('kb_rerank_model', input.rerankModel.trim())
  if (typeof input.apiKey === 'string') {
    const secrets = { ...readSecrets() }
    if (input.apiKey.trim()) secrets.kbEmbeddingKey = input.apiKey.trim()
    else delete secrets.kbEmbeddingKey
    writeSecrets(secrets)
  }
  return getKbConfig()
}

export function kbEmbeddingKey() {
  return readSecrets().kbEmbeddingKey || ''
}

/* ---------------- memories ---------------- */

const rowToMemory = (r) => ({
  id: r.id,
  projectId: r.project_id,
  content: r.content,
  source: r.source,
  sourceSessionId: r.source_session_id ?? null,
  sourceTurnId: r.source_turn_id ?? null,
  sourceFileId: r.source_file_id ?? null,
  status: r.status,
  importance: r.importance,
  reflectNote: r.reflect_note ?? null,
  dedupeHash: r.dedupe_hash ?? null,
  embedding: r.embedding ? Buffer.from(r.embedding) : null,
  embeddingModel: r.embedding_model || '',
  expiresAt: r.expires_at ?? null,
  lastUsedAt: r.last_used_at ?? null,
  lastReflectedAt: r.last_reflected_at ?? null,
  createdBy: r.created_by || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at ?? null,
})

const rowToMemorySettings = (r) => ({
  projectId: r.project_id,
  autoCollect: Boolean(r.auto_collect),
  injectMemory: Boolean(r.inject_memory),
  collectRules: r.collect_rules || '',
  collectEvery: r.collect_every,
  retentionDays: r.retention_days,
  permanent: Boolean(r.permanent),
  expirePolicy: r.expire_policy,
  autoReflect: Boolean(r.auto_reflect),
  reflectFrequency: r.reflect_frequency,
  reflectRules: r.reflect_rules || '',
  lastRetentionAt: r.last_retention_at ?? null,
  lastReflectAt: r.last_reflect_at ?? null,
  updatedAt: r.updated_at,
})

/** 把项目所有会话的收集游标推到当前最大 seq（不回灌历史） */
export function resetProjectCollectCursors(projectId) {
  db.prepare(`UPDATE sessions
              SET memory_collect_cursor = (
                SELECT COALESCE(MAX(seq), 0) FROM turns
                WHERE turns.session_id = sessions.id AND turns.status = 'done'
              )
              WHERE project_id = ?`).run(projectId)
}

/** 读设置；不存在时建默认行并初始化游标 */
export function ensureMemorySettings(projectId) {
  const now = nowISO()
  const result = db.prepare('INSERT OR IGNORE INTO memory_settings (project_id, updated_at) VALUES (?, ?)')
    .run(projectId, now)
  if (result.changes > 0) resetProjectCollectCursors(projectId)
  return rowToMemorySettings(db.prepare('SELECT * FROM memory_settings WHERE project_id = ?').get(projectId))
}

export function getMemorySettings(projectId) {
  const row = db.prepare('SELECT * FROM memory_settings WHERE project_id = ?').get(projectId)
  return row ? rowToMemorySettings(row) : null
}

export function memoryExpiresAt(createdAt, settings) {
  if (settings.permanent) return null
  const days = Math.max(1, Math.min(3650, Number(settings.retentionDays) || 90))
  const base = Date.parse(createdAt)
  return Number.isFinite(base) ? new Date(base + days * 86_400_000).toISOString() : null
}

/** 保留天数 / 永久标记变化后，重算未归档记忆的过期时间 */
export function recomputeMemoryExpiry(projectId, settings) {
  const now = nowISO()
  const rows = db.prepare("SELECT id, created_at FROM memories WHERE project_id = ? AND status = 'active'")
    .all(projectId)
  if (rows.length === 0) return
  db.exec('BEGIN')
  try {
    const stmt = db.prepare('UPDATE memories SET expires_at = ?, updated_at = ? WHERE id = ?')
    for (const row of rows) stmt.run(memoryExpiresAt(row.created_at, settings), now, row.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function touchMemorySettingsRun(projectId, field) {
  const column = field === 'reflect' ? 'last_reflect_at' : 'last_retention_at'
  const now = nowISO()
  db.prepare(`UPDATE memory_settings SET ${column} = ?, updated_at = ? WHERE project_id = ?`)
    .run(now, now, projectId)
}

export function saveMemorySettings(projectId, patch = {}) {
  const existing = ensureMemorySettings(projectId)
  const next = {
    autoCollect: patch.autoCollect ?? existing.autoCollect,
    injectMemory: patch.injectMemory ?? existing.injectMemory,
    collectRules: patch.collectRules ?? existing.collectRules,
    collectEvery: patch.collectEvery ?? existing.collectEvery,
    retentionDays: patch.retentionDays ?? existing.retentionDays,
    permanent: patch.permanent ?? existing.permanent,
    expirePolicy: patch.expirePolicy ?? existing.expirePolicy,
    autoReflect: patch.autoReflect ?? existing.autoReflect,
    reflectFrequency: patch.reflectFrequency ?? existing.reflectFrequency,
    reflectRules: patch.reflectRules ?? existing.reflectRules,
  }
  db.prepare(`UPDATE memory_settings SET
      auto_collect = ?, inject_memory = ?, collect_rules = ?, collect_every = ?,
      retention_days = ?, permanent = ?, expire_policy = ?, auto_reflect = ?,
      reflect_frequency = ?, reflect_rules = ?, updated_at = ?
    WHERE project_id = ?`).run(
    next.autoCollect ? 1 : 0,
    next.injectMemory ? 1 : 0,
    next.collectRules,
    next.collectEvery,
    next.retentionDays,
    next.permanent ? 1 : 0,
    next.expirePolicy,
    next.autoReflect ? 1 : 0,
    next.reflectFrequency,
    next.reflectRules,
    nowISO(),
    projectId,
  )
  if (!existing.autoCollect && next.autoCollect) resetProjectCollectCursors(projectId)
  if (existing.retentionDays !== next.retentionDays || existing.permanent !== next.permanent) {
    recomputeMemoryExpiry(projectId, next)
  }
  return getMemorySettings(projectId)
}

export function listMemories(projectId, { status = 'all', q = '', limit = 100, offset = 0 } = {}) {
  const where = ['project_id = ?']
  const params = [projectId]
  if (status === 'all' || !status) {
    where.push("status <> 'deleted'")
  } else {
    where.push('status = ?')
    params.push(status)
  }
  const text = String(q || '').trim()
  if (text) {
    where.push("content LIKE ? ESCAPE '\\'")
    params.push(`%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
  }
  const size = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const start = Math.max(Number(offset) || 0, 0)
  return db.prepare(`SELECT * FROM memories WHERE ${where.join(' AND ')}
                     ORDER BY (status = 'archived') ASC, created_at DESC
                     LIMIT ? OFFSET ?`).all(...params, size, start).map(rowToMemory)
}

/** 召回候选：active 且未过期，最多 2000 条 */
export function listActiveMemories(projectId, limit = 2000) {
  const now = nowISO()
  return db.prepare(`SELECT * FROM memories
                     WHERE project_id = ? AND status = 'active'
                       AND (expires_at IS NULL OR expires_at > ?)
                     ORDER BY created_at DESC LIMIT ?`)
    .all(projectId, now, Math.max(1, Math.min(Number(limit) || 2000, 5000)))
    .map(rowToMemory)
}

export function memoryCounts(projectId) {
  const cutoff = new Date(Date.now() + 7 * 86_400_000).toISOString()
  const total = db.prepare("SELECT COUNT(*) AS c FROM memories WHERE project_id = ? AND status <> 'deleted'").get(projectId).c
  const archived = db.prepare("SELECT COUNT(*) AS c FROM memories WHERE project_id = ? AND status = 'archived'").get(projectId).c
  const expiring = db.prepare(`SELECT COUNT(*) AS c FROM memories
                               WHERE project_id = ? AND status = 'active'
                                 AND expires_at IS NOT NULL AND expires_at <= ?`).get(projectId, cutoff).c
  return { total, expiring, archived }
}

export function getMemory(id) {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
  return row ? rowToMemory(row) : null
}

export function findMemoryByHash(projectId, hash, { includeDeleted = false } = {}) {
  if (!hash) return null
  const row = includeDeleted
    ? db.prepare('SELECT * FROM memories WHERE project_id = ? AND dedupe_hash = ? LIMIT 1').get(projectId, hash)
    : db.prepare("SELECT * FROM memories WHERE project_id = ? AND dedupe_hash = ? AND status <> 'deleted' LIMIT 1").get(projectId, hash)
  return row ? rowToMemory(row) : null
}

export function insertMemory(input) {
  const now = nowISO()
  const id = input.id ?? newId('mem')
  const createdAt = input.createdAt ?? now
  db.prepare(`INSERT INTO memories (
      id, project_id, content, source, source_session_id, source_turn_id, source_file_id,
      status, importance, reflect_note, dedupe_hash, embedding, embedding_model, expires_at,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    input.projectId,
    input.content,
    input.source ?? '手动',
    input.sourceSessionId ?? null,
    input.sourceTurnId ?? null,
    input.sourceFileId ?? null,
    input.status ?? 'active',
    input.importance ?? 0.5,
    input.reflectNote ?? null,
    input.dedupeHash ?? null,
    input.embedding ?? null,
    input.embeddingModel ?? '',
    input.expiresAt ?? null,
    input.createdBy ?? '',
    createdAt,
    now,
  )
  return getMemory(id)
}

/** 批量插入（同一事务），供自动收集使用 */
export function insertMemoriesBatch(items) {
  if (!items.length) return []
  const now = nowISO()
  const ids = []
  db.exec('BEGIN')
  try {
    const stmt = db.prepare(`INSERT INTO memories (
        id, project_id, content, source, source_session_id, source_turn_id, source_file_id,
        status, importance, reflect_note, dedupe_hash, embedding, embedding_model, expires_at,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const input of items) {
      const id = input.id ?? newId('mem')
      const createdAt = input.createdAt ?? now
      stmt.run(
        id,
        input.projectId,
        input.content,
        input.source ?? '会话沉淀',
        input.sourceSessionId ?? null,
        input.sourceTurnId ?? null,
        input.sourceFileId ?? null,
        input.status ?? 'active',
        input.importance ?? 0.5,
        input.reflectNote ?? null,
        input.dedupeHash ?? null,
        input.embedding ?? null,
        input.embeddingModel ?? '',
        input.expiresAt ?? null,
        input.createdBy ?? '',
        createdAt,
        now,
      )
      ids.push(id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return ids.map(getMemory)
}

export function setMemoryEmbedding(id, embedding, model) {
  db.prepare('UPDATE memories SET embedding = ?, embedding_model = ?, updated_at = ? WHERE id = ?')
    .run(embedding ?? null, model || '', nowISO(), id)
}

export function setMemoryStatus(id, status) {
  const now = nowISO()
  db.prepare('UPDATE memories SET status = ?, deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(status, status === 'deleted' ? now : null, now, id)
}

export function listExpiredMemories(projectId, now = nowISO()) {
  return db.prepare(`SELECT * FROM memories
                     WHERE project_id = ? AND status = 'active'
                       AND expires_at IS NOT NULL AND expires_at <= ?`)
    .all(projectId, now).map(rowToMemory)
}

export function archiveMemories(projectId, cutoff) {
  const rows = db.prepare(`SELECT id FROM memories
                           WHERE project_id = ? AND status = 'active'
                             AND expires_at IS NOT NULL AND expires_at <= ?`).all(projectId, cutoff)
  if (rows.length === 0) return []
  const now = nowISO()
  db.exec('BEGIN')
  try {
    const stmt = db.prepare('UPDATE memories SET status = ?, updated_at = ? WHERE id = ?')
    for (const row of rows) stmt.run('archived', now, row.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return rows.map((r) => r.id)
}

export function touchMemoryUsage(ids, at = nowISO()) {
  if (!ids.length) return
  db.exec('BEGIN')
  try {
    const stmt = db.prepare('UPDATE memories SET last_used_at = ? WHERE id = ?')
    for (const id of ids) stmt.run(at, id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function insertMemoryEvent({ projectId, memoryId, type, actor = '', payload = {} }) {
  db.prepare(`INSERT INTO memory_events (id, project_id, memory_id, type, actor, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    newId('mev'), projectId, memoryId, type, actor, JSON.stringify(payload), nowISO(),
  )
}

export function listMemoryEvents(memoryId) {
  return db.prepare('SELECT * FROM memory_events WHERE memory_id = ? ORDER BY created_at ASC')
    .all(memoryId)
    .map((r) => ({
      id: r.id,
      projectId: r.project_id,
      memoryId: r.memory_id,
      type: r.type,
      actor: r.actor,
      payload: parseJSON(r.payload_json, {}),
      createdAt: r.created_at,
    }))
}

export function createMemoryJobRun({ projectId, kind, trigger = 'threshold' }) {
  const id = newId('mjr')
  db.prepare(`INSERT INTO memory_job_runs (id, project_id, kind, trigger, status, started_at)
              VALUES (?, ?, ?, ?, 'running', ?)`).run(id, projectId, kind, trigger, nowISO())
  return id
}

export function updateMemoryJobRun(id, patch = {}) {
  db.prepare(`UPDATE memory_job_runs SET status = ?, scanned = ?, changed = ?,
                detail_json = ?, error = ?, finished_at = ?
              WHERE id = ?`).run(
    patch.status ?? 'done',
    patch.scanned ?? 0,
    patch.changed ?? 0,
    JSON.stringify(patch.detail ?? {}),
    patch.error ?? null,
    nowISO(),
    id,
  )
}

export function getSessionCollectCursor(sessionId) {
  const row = db.prepare('SELECT memory_collect_cursor AS cursor FROM sessions WHERE id = ?').get(sessionId)
  return row?.cursor ?? 0
}

export function advanceSessionCollectCursor(sessionId, seq) {
  db.prepare('UPDATE sessions SET memory_collect_cursor = MAX(memory_collect_cursor, ?) WHERE id = ?')
    .run(Number(seq) || 0, sessionId)
}

export function countPendingMemoryTurns(sessionId) {
  const cursor = getSessionCollectCursor(sessionId)
  return db.prepare(`SELECT COUNT(*) AS c FROM turns
                     WHERE session_id = ? AND status = 'done' AND seq > ?`).get(sessionId, cursor).c
}

export function listDoneTurnsAfter(sessionId, cursor) {
  return db.prepare(`SELECT * FROM turns
                     WHERE session_id = ? AND status = 'done' AND seq > ?
                     ORDER BY seq ASC`).all(sessionId, cursor).map(rowToTurn)
}

export function listPendingSessionIds(projectId) {
  return db.prepare(`SELECT s.id FROM sessions s
                     WHERE s.project_id = ? AND EXISTS (
                       SELECT 1 FROM turns t
                       WHERE t.session_id = s.id AND t.status = 'done'
                         AND t.seq > s.memory_collect_cursor
                     )`).all(projectId).map((r) => r.id)
}

/* ---------------- seed project agents ---------------- */

/** 为种子项目创建对应的 Agent（config.localId 用于对齐 Mock 会话轨迹里的 a1/a2） */
export function ensureSeedProjectAgents() {
  const runtime = ensureSeedRuntime()
  const modelFor = (index) => runtime.models[index] || runtime.models[0] || 'deepseek-chat'

  const seeds = [
    {
      projectId: 'loomweb',
      agents: [
        {
          localId: 'a1', name: '研发工程师ADE', role: '研发工程师', model: modelFor(0),
          status: '工作中', currentTask: '登录模块重构', linkedProject: 'loomweb',
          multimodalModel: 'kimi/kimi-k3', collabModel: '',
          knowledgeBases: ['研发规范库'], mcpServices: ['代码仓库 MCP'],
          adeMd: '## 你是谁\n\n你是本项目的研发工程师，负责 Web 端功能开发与重构。\n\n## 你能做什么\n\n- 实现与重构业务组件\n- 排查并修复缺陷\n- 输出技术方案与代码评审意见\n\n## 你应该怎么说话\n\n- 说话简洁\n- 结论先行，必要时给出依据',
          tools: { gitlab: true, jenkins: false, zentao: false, jira: false, confluence: false, feishu: false, wecom: false },
        },
        {
          localId: 'a2', name: '测试工程师ADE', role: '测试工程师', model: modelFor(1),
          status: '空闲', currentTask: '', linkedProject: 'loomweb',
          multimodalModel: 'qwen3-vl-plus', collabModel: 'qwen3-max',
          knowledgeBases: ['产品需求库'], mcpServices: [],
          adeMd: '## 你是谁\n\n你是本项目的测试工程师，负责用例设计与回归验证。\n\n## 你能做什么\n\n- 编写与维护测试用例\n- 执行回归并输出报告\n- 跟踪缺陷直至关闭\n\n## 你应该怎么说话\n\n- 说话简洁\n- 缺陷描述附带复现步骤',
          tools: { gitlab: false, jenkins: true, zentao: true, jira: false, confluence: false, feishu: false, wecom: false },
        },
      ],
    },
    {
      projectId: 'yigou-app',
      agents: [
        {
          localId: 'a1', name: '研发工程师ADE', role: '研发工程师', model: modelFor(0),
          status: '工作中', currentTask: '支付联调', linkedProject: '翼构移动应用',
          multimodalModel: 'kimi/kimi-k3', collabModel: '',
          knowledgeBases: ['研发规范库', '运维手册'], mcpServices: ['代码仓库 MCP', '数据库 MCP'],
          adeMd: '## 你是谁\n\n你是移动端研发工程师，负责商城与支付模块开发。\n\n## 你能做什么\n\n- 业务功能开发与联调\n- 支付链路问题排查\n- 性能与稳定性优化\n\n## 你应该怎么说话\n\n- 说话简洁\n- 涉及资金链路时格外严谨',
          tools: { gitlab: true, jenkins: true, zentao: false, jira: false, confluence: false, feishu: false, wecom: false },
        },
      ],
    },
  ]

  for (const group of seeds) {
    if (!getProject(group.projectId)) continue
    for (const agent of group.agents) {
      const id = `agent_${group.projectId}_${agent.localId}`
      if (getAgent(id)) continue
      saveAgent({
        id,
        name: agent.name,
        role: agent.role,
        model: agent.model,
        provider: runtime.provider,
        permission: 'workspace-write',
        workdir: DEFAULT_WORKDIR,
        projectId: group.projectId,
        runtimeId: runtime.id,
        config: {
          localId: agent.localId,
          status: agent.status,
          currentTask: agent.currentTask,
          linkedProject: agent.linkedProject,
          multimodalModel: agent.multimodalModel,
          collabModel: agent.collabModel,
          knowledgeBases: agent.knowledgeBases,
          mcpServices: agent.mcpServices,
          adeMd: agent.adeMd,
          tools: agent.tools,
        },
      })
    }
  }
}

/* ---------------- seed projects ---------------- */

export function ensureSeedProjects() {
  // 清理早期自动创建的默认项目（ensureSeedAgent 在无项目时建的那条）
  const legacy = db.prepare("SELECT id FROM projects WHERE name = 'loomweb' AND description = '默认项目' AND folder_id IS NULL").get()
  if (legacy && legacy.id !== 'loomweb') deleteProject(legacy.id)

  const seedFolders = [
    { id: 'f-dev', name: '研发线', members: [{ name: 'shilu', role: 'owner' }, { name: 'luyu', role: 'member' }] },
    { id: 'f-data', name: '数据平台', members: [{ name: 'wang', role: 'owner' }, { name: 'shilu', role: 'member' }] },
  ]
  for (const folder of seedFolders) {
    if (!db.prepare('SELECT id FROM project_folders WHERE id = ?').get(folder.id)) {
      saveProjectFolder(folder)
    }
  }

  const seeds = [
    {
      id: 'loomweb', name: 'loomweb', description: 'Loom Web 端研发', status: '进行中',
      startDate: '2026-07-02', endDate: '2026-09-30', folderId: 'f-dev',
      members: [
        { name: 'shilu', role: '前端', permission: '项目负责人' },
        { name: 'luyu', role: '后端', permission: '管理员' },
        { name: 'wang', role: '测试' },
        { name: 'chen', role: '产品' },
      ],
    },
    {
      id: 'yigou-app', name: 'yigou-app', description: '翼构移动应用', status: '进行中',
      startDate: '2026-05-18', endDate: '2026-08-31', folderId: 'f-dev',
      members: [
        { name: 'luyu', role: '后端', permission: '项目负责人' },
        { name: 'zhao', role: '移动端' },
        { name: 'sun', role: '测试' },
      ],
    },
    {
      id: 'data-pipeline', name: 'data-pipeline', description: '数据管道平台', status: '规划中',
      startDate: '2026-09-01', endDate: '2026-12-31', folderId: 'f-data',
      members: [
        { name: 'wang', role: '数据', permission: '项目负责人' },
        { name: 'shilu', role: '平台' },
      ],
    },
  ]

  for (const seed of seeds) {
    if (db.prepare('SELECT id FROM projects WHERE id = ?').get(seed.id)) continue
    const { members, ...meta } = seed
    saveProject(meta)
    replaceProjectMembers(seed.id, members)
  }
}

/* ---------------- org members ---------------- */

const rowToOrgMember = (r) => ({
  id: r.id,
  name: r.name,
  role: r.role,
  permission: r.permission,
  online: Boolean(r.online),
  lastActive: r.last_active,
  source: r.source,
  createdAt: r.created_at,
})

export function listOrgMembers() {
  return db.prepare('SELECT * FROM org_members ORDER BY created_at ASC').all().map(rowToOrgMember)
}

export function getOrgMember(id) {
  const row = db.prepare('SELECT * FROM org_members WHERE id = ?').get(id)
  return row ? rowToOrgMember(row) : null
}

export function addOrgMember(input) {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('成员姓名不能为空')
  const existing = db.prepare('SELECT id FROM org_members WHERE name = ?').get(name)
  if (existing) throw new Error(`成员「${name}」已存在`)
  const id = input.id ?? newId('om')
  // 名单成员只有 管理员 / 成员；所有者是登录身份，不在名单里
  const permission = input.permission === '管理员' ? '管理员' : '成员'
  db.prepare(`INSERT INTO org_members (id, name, role, permission, online, last_active, source, created_at)
              VALUES (?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(id, name, (input.role ?? '').trim(), permission, input.lastActive ?? '活跃于 刚刚', input.source ?? 'manual', nowISO())
  return getOrgMember(id)
}

export function updateOrgMember(id, patch) {
  const existing = getOrgMember(id)
  if (!existing) return null
  const role = patch.role === undefined ? existing.role : String(patch.role).trim()
  const permission = patch.permission === undefined ? existing.permission : patch.permission
  if (!['管理员', '成员'].includes(permission)) throw new Error('名单成员权限只能是 管理员 或 成员')
  db.prepare('UPDATE org_members SET role = ?, permission = ? WHERE id = ?').run(role, permission, id)
  return getOrgMember(id)
}

export function removeOrgMember(id) {
  const existing = getOrgMember(id)
  if (!existing) return { ok: false, error: '成员不存在', status: 404 }
  db.prepare('DELETE FROM org_members WHERE id = ?').run(id)
  return { ok: true }
}

/** 批量导入：按姓名去重（库内已存在 + 请求内重复），返回导入/跳过数量 */
export function importOrgMembers(contacts, permission) {
  const perm = permission === '管理员' ? '管理员' : '成员'
  const existing = new Set(listOrgMembers().map((m) => m.name))
  let imported = 0
  let skipped = 0
  db.exec('BEGIN')
  try {
    for (const contact of contacts) {
      const name = String(contact?.name ?? '').trim()
      if (!name || existing.has(name)) { skipped += 1; continue }
      db.prepare(`INSERT INTO org_members (id, name, role, permission, online, last_active, source, created_at)
                  VALUES (?, ?, ?, ?, 0, ?, 'feishu', ?)`)
        .run(newId('om'), name, String(contact?.title ?? '').trim() || '成员', perm, '活跃于 刚刚', nowISO())
      existing.add(name)
      imported += 1
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { imported, skipped }
}

/* ---------------- org settings ---------------- */

export function getOrgSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM org_settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setOrgSetting(key, value) {
  db.prepare(`INSERT INTO org_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value))
}

export function deleteOrgSetting(key) {
  db.prepare('DELETE FROM org_settings WHERE key = ?').run(key)
}

/** 飞书 OAuth 重定向地址：优先界面保存值，其次环境变量 */
export function getFeishuRedirectUri() {
  const stored = getOrgSetting('feishu_redirect_uri')
  return stored || process.env.FEISHU_REDIRECT_URI || ''
}

export function setFeishuRedirectUri(uri) {
  setOrgSetting('feishu_redirect_uri', String(uri || '').trim())
}

/** 个人授权申请的云文档 scope 档位：none | read | write | all */
export const FEISHU_DOC_SCOPE_LEVELS = ['none', 'read', 'write', 'all']

export function getFeishuDocScopeLevel() {
  const raw = getOrgSetting('feishu_doc_scope_level', 'read')
  return FEISHU_DOC_SCOPE_LEVELS.includes(raw) ? raw : 'read'
}

/** 修改授权范围：旧令牌权限不再匹配，重置授权状态要求重新授权 */
export function setFeishuDocScopeLevel(level) {
  const next = FEISHU_DOC_SCOPE_LEVELS.includes(level) ? level : 'read'
  setOrgSetting('feishu_doc_scope_level', next)
  setFeishuAuthorized(false)
  return next
}

/** 飞书授权状态（凭证只回 appId 与 hasSecret） */
export function getFeishuConfig() {
  const secrets = readSecrets()
  const feishu = secrets.feishu || {}
  return {
    appId: feishu.appId || '',
    hasSecret: Boolean(feishu.appSecret),
    redirectUri: getFeishuRedirectUri(),
    connected: getOrgSetting('feishu_connected') === '1',
    connectedAt: getOrgSetting('feishu_connected_at'),
    authorized: getOrgSetting('feishu_authorized') === '1',
    account: getOrgSetting('feishu_account'),
    authorizedAt: getOrgSetting('feishu_authorized_at'),
    docScopeLevel: getFeishuDocScopeLevel(),
  }
}

export function getFeishuCredentials() {
  const feishu = readSecrets().feishu || {}
  return { appId: feishu.appId || '', appSecret: feishu.appSecret || '' }
}

export function setFeishuCredentials(appId, appSecret) {
  const secrets = { ...readSecrets() }
  if (!appId && !appSecret) delete secrets.feishu
  else secrets.feishu = { appId: (appId || '').trim(), appSecret: (appSecret || '').trim() }
  writeSecrets(secrets)
}

export function setFeishuConnected(connected) {
  setOrgSetting('feishu_connected', connected ? '1' : '0')
  setOrgSetting('feishu_connected_at', connected ? nowISO() : '')
}

export function setFeishuAuthorized(authorized, account = '') {
  setOrgSetting('feishu_authorized', authorized ? '1' : '0')
  setOrgSetting('feishu_account', authorized ? account : '')
  setOrgSetting('feishu_authorized_at', authorized ? nowISO() : '')
}

/* —— 个人授权：user_access_token（只存服务端，不下发前端） —— */

export function getFeishuUserToken() {
  return readSecrets().feishuUser || null
}

export function setFeishuUserToken(token) {
  const secrets = { ...readSecrets() }
  secrets.feishuUser = token
  writeSecrets(secrets)
}

export function clearFeishuUserToken() {
  const secrets = { ...readSecrets() }
  delete secrets.feishuUser
  writeSecrets(secrets)
}

/* ---------------- seed ---------------- */

/* ---------------- login session（本地占位，后续替换为飞书 OAuth） ---------------- */

export function getCurrentUser() {
  const name = getOrgSetting('current_user_name')
  if (!name) return null
  return { name, permission: getOrgSetting('current_user_permission') || '所有者' }
}

export function setCurrentUser(name, permission = '所有者') {
  setOrgSetting('current_user_name', String(name).trim())
  setOrgSetting('current_user_permission', permission)
  return getCurrentUser()
}

export function clearCurrentUser() {
  deleteOrgSetting('current_user_name')
  deleteOrgSetting('current_user_permission')
}

/* ---------------- multi-user login sessions（Cookie token） ---------------- */

const AUTH_SESSION_TTL_MS = 7 * 24 * 3600 * 1000

export function createAuthSession(name, permission = '成员') {
  const token = crypto.randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + AUTH_SESSION_TTL_MS)
  db.prepare(`INSERT INTO auth_sessions (token, user_name, permission, created_at, last_seen_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(token, String(name).trim(), permission, now.toISOString(), now.toISOString(), expires.toISOString())
  return token
}

export function getAuthSession(token) {
  if (!token) return null
  const row = db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(token)
  if (!row) return null
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token)
    return null
  }
  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token = ?').run(nowISO(), token)
  return { name: row.user_name, permission: row.permission }
}

export function deleteAuthSession(token) {
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token)
}

export function deleteExpiredAuthSessions() {
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowISO())
}

/* ---------------- admin account ---------------- */

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const verifyPassword = (password, stored) => {
  const [salt, hash] = String(stored || '').split(':')
  if (!salt || !hash) return false
  try {
    const next = crypto.scryptSync(password, salt, 64)
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), next)
  } catch {
    return false
  }
}

export function getAdminAccount() {
  const row = db.prepare('SELECT username, created_at FROM admin_account WHERE id = 1').get()
  return row ? { username: row.username, createdAt: row.created_at } : null
}

/** 首次初始化管理员账号（只允许一次） */
export function createAdminAccount(username, password) {
  if (getAdminAccount()) throw new Error('管理员账号已存在')
  const name = String(username || '').trim()
  if (name.length < 2) throw new Error('用户名至少 2 个字符')
  if (String(password || '').length < 6) throw new Error('密码至少 6 位')
  db.prepare('INSERT INTO admin_account (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)')
    .run(name, hashPassword(password), nowISO())
  return getAdminAccount()
}

export function verifyAdminCredentials(username, password) {
  const row = db.prepare('SELECT username, password_hash FROM admin_account WHERE id = 1').get()
  if (!row) return false
  if (row.username !== String(username || '').trim()) return false
  return verifyPassword(String(password || ''), row.password_hash)
}

/* ---------------- seed ---------------- */

export function ensureSeedRuntime() {
  const runtimes = listRuntimes()
  if (runtimes.length > 0) return runtimes[0]
  return saveRuntime({
    id: 'rt_default',
    name: 'DeepSeek 官方',
    provider: 'deepseek-official',
    baseUrl: '',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash'],
  })
}

export function ensureSeedAgent() {
  const runtime = ensureSeedRuntime()
  let project = listProjects()[0]
  if (!project) {
    project = saveProject({ name: 'loomweb', description: '默认项目', status: '进行中' })
  }

  const agents = listAgents()
  if (agents.length === 0) {
    saveAgent({
      name: 'Acho',
      role: '研发工程师',
      model: runtime.models[0] || 'deepseek-chat',
      provider: runtime.provider,
      permission: 'workspace-write',
      workdir: DEFAULT_WORKDIR,
      projectId: project.id,
      runtimeId: runtime.id,
      config: {
        status: '空闲',
        linkedProject: project.name,
        multimodalModel: '',
        collabModel: '',
        knowledgeBases: [],
        mcpServices: [],
        adeMd: '',
        tools: {},
      },
    })
    return
  }

  for (const agent of agents) {
    const patch = {}
    if (!agent.projectId) patch.projectId = project.id
    if (!agent.runtimeId) patch.runtimeId = runtime.id
    if (Object.keys(patch).length > 0) saveAgent({ ...agent, ...patch })
  }
}
