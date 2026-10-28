import { useEffect, useRef, useState } from 'react'
import type { Project, ProjectFolder } from '../data/projects'
import { getPeriodState, formatPeriodRange } from '../data/projects'
import StatusBadge, { type BadgeTone } from './StatusBadge'
import { FolderIcon, CalendarIcon } from './icons'
import './ProjectCard.css'

const statusTone: Record<Project['status'], BadgeTone> = {
  进行中: 'success',
  已完成: 'info',
  规划中: 'neutral',
}

/** 周期状态 → 徽标（null = 不显示，避免噪音） */
function periodBadge(project: Project): { tone: BadgeTone; text: string } | null {
  const state = getPeriodState(project)
  switch (state.kind) {
    case 'expiring': return { tone: 'warning', text: `剩 ${state.days} 天` }
    case 'overdue': return { tone: 'danger', text: `已逾期 ${state.days} 天` }
    case 'not-started': return { tone: 'neutral', text: `${state.days} 天后启动` }
    default: return null
  }
}

interface ProjectCardProps {
  project: Project
  folders: ProjectFolder[]
  onOpen: () => void
  /** 移动到文件夹（undefined = 未分组） */
  onMove: (folderId: string | undefined) => void
  /** 删除项目（软删除） */
  onDelete: () => void
}

/** 项目卡片：基本信息 + 周期 + 成员概况（不含任务）+ ⋯ 菜单移动文件夹 / 删除项目 */
export default function ProjectCard({ project, folders, onOpen, onMove, onDelete }: ProjectCardProps) {
  const shown = project.members.slice(0, 4)
  const badge = periodBadge(project)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  /** 点击卡片外部关闭菜单 */
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <div className="project-card-wrap" ref={rootRef}>
      <button type="button" className="project-card" onClick={onOpen}>
        <div className="project-card-head">
          <span className="project-card-name">
            <FolderIcon size={15} />
            {project.name}
          </span>
          <StatusBadge tone={statusTone[project.status]}>{project.status}</StatusBadge>
        </div>
        <p className="project-card-desc">{project.description}</p>
        <div className="project-card-period">
          <span className="project-card-period-range">
            <CalendarIcon size={13} />
            {formatPeriodRange(project.startDate, project.endDate)}
          </span>
          {badge && <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>}
        </div>
        <div className="project-card-foot">
          <span className="project-card-avatars">
            {shown.map((m) => (
              <span key={m.id} className="project-card-avatar">{m.initial}</span>
            ))}
          </span>
          <span className="project-card-meta">
            {project.members.length} 成员 · {project.agents.length} agent
          </span>
        </div>
      </button>

      <button
        type="button"
        className="project-card-menu-btn"
        aria-label="项目操作"
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen((v) => !v)
        }}
      >
        ⋯
      </button>

      {menuOpen && (
        <div className="project-card-menu" role="menu">
          <p className="project-card-menu-label">移动到</p>
          <button
            type="button"
            className="project-card-menu-item"
            disabled={!project.folderId}
            onClick={() => {
              onMove(undefined)
              setMenuOpen(false)
            }}
          >
            未分组
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              className="project-card-menu-item"
              disabled={project.folderId === f.id}
              onClick={() => {
                onMove(f.id)
                setMenuOpen(false)
              }}
            >
              {f.name}
            </button>
          ))}
          <div className="project-card-menu-divider" />
          <button
            type="button"
            className="project-card-menu-item danger"
            onClick={() => {
              onDelete()
              setMenuOpen(false)
            }}
          >
            删除项目
          </button>
        </div>
      )}
    </div>
  )
}
