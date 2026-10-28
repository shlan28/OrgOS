import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './db.js'

/** 沙箱根目录：本地/云端都可挂载到独立卷 */
export const SANDBOX_ROOT = process.env.ORG_OS_SANDBOX_DIR || path.join(DATA_DIR, 'sandboxes')

const SAFE_ID = /^[A-Za-z0-9_-]+$/

export const safeProjectId = (projectId) => {
  const id = String(projectId || '')
  return SAFE_ID.test(id) ? id : id.replace(/[^A-Za-z0-9_-]/g, '-')
}

export function projectSandboxDir(projectId) {
  return path.join(SANDBOX_ROOT, safeProjectId(projectId))
}

export function sandboxExists(projectId) {
  try {
    return fs.existsSync(projectSandboxDir(projectId))
  } catch {
    return false
  }
}

/** 确保研发项目沙箱目录与元信息存在；非研发项目返回 disabled */
export function ensureProjectSandbox(project) {
  if (!project || project.type !== 'dev') {
    return { enabled: false, dir: null }
  }
  const dir = projectSandboxDir(project.id)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const sub of ['repos', 'worktrees', 'artifacts', 'logs', 'home']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true, mode: 0o700 })
  }
  const metaPath = path.join(dir, 'meta.json')
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({
      projectId: project.id,
      type: project.type,
      workspaceMode: project.workspaceMode || 'serial',
      createdAt: new Date().toISOString(),
    }, null, 2))
  }
  return { enabled: true, dir }
}
