import type { Project, ProjectSession } from '../../data/projects'
import { sessionColorOf } from '../../data/projects'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import type { JobRun } from '../../data/projects'
import './SessionRail.css'

/** auto 会话 → 关联任务当前/最近运行的状态（无运行 = 已结束） */
const sessionRun = (sessions: Project['autoJobs'], session: ProjectSession): JobRun | undefined => {
  if (session.source !== 'auto' || !session.jobId) return undefined
  const job = sessions.find((j) => j.id === session.jobId)
  return job?.currentRun ?? job?.history[0]
}

const runTone: Record<JobRun['status'], BadgeTone> = {
  排队中: 'neutral',
  运行中: 'info',
  等待确认: 'warning',
  等待输入: 'warning',
  已暂停: 'warning',
  成功: 'success',
  失败: 'danger',
  已取消: 'neutral',
  已拒绝: 'neutral',
}

interface SessionRailProps {
  project: Project
  sessions: ProjectSession[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onNewSession: () => void
  /** 打开编辑项目弹窗（原格 2 头部「编辑」迁入，改 icon） */
  onOpenEdit: () => void
}

/** 格 1：常驻会话列表（头部「项目名 · 会话」项目名可点开编辑弹窗 + 右上角 ＋ 新会话） */
export default function SessionRail({
  project, sessions, activeSessionId, onSelect, onNewSession, onOpenEdit,
}: SessionRailProps) {
  const sorted = [...sessions].sort((a, b) => b.order - a.order)

  return (
    <div className="session-rail">
      <div className="rail-head">
        <span className="rail-title" title={`${project.name} · 会话`}>
          <button
            type="button"
            className="rail-proj-btn"
            title="编辑项目"
            onClick={onOpenEdit}
          >
            {project.name}
          </button>
          <span className="rail-sep">·</span>
          <span className="rail-word">会话</span>
        </span>
        <span className="rail-count">{sessions.length} 个</span>
        <button type="button" className="rail-icon-btn rail-new-btn" title="新会话" aria-label="新会话" onClick={onNewSession}>
          ＋
        </button>
      </div>
      <div className="rail-body">
        {sorted.map((s) => {
          const run = sessionRun(project.autoJobs, s)
          const statusText = run?.status ?? '已结束'
          return (
            <button
              key={s.id}
              type="button"
              className={`rail-sess${s.id === activeSessionId ? ' current' : ''}`}
              onClick={() => onSelect(s.id)}
              title={s.name}
            >
              <span className="rail-sava" style={{ background: sessionColorOf(s.id) }}>
                {s.name.slice(0, 2)}
              </span>
              <span className="rail-cols">
                <span className="rail-row1">
                  <span className="rail-name">{s.name}</span>
                  {s.source === 'auto' && <span className="rail-dot" />}
                  {s.unread > 0 && <span className="rail-unread">{s.unread}</span>}
                </span>
                <span className="rail-row2">
                  <StatusBadge tone={run ? runTone[run.status] : 'neutral'}>{statusText}</StatusBadge>
                  <span className="rail-sub">{s.originText}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
