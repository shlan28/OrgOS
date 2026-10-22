import { useEffect, useRef, useState } from 'react'
import type { ProjectFolder } from '../data/projects'
import './FolderCard.css'

interface FolderCardProps {
  folder: ProjectFolder
  /** 文件夹内项目数 */
  count: number
  onOpen: () => void
  /** 打开编辑文件夹弹窗（名称 + 成员范围） */
  onEdit: () => void
  onDelete: () => void
}

/** 文件夹卡片：堆叠图标 + 名称 + 项目数 + 成员概况 + ⋯ 菜单（编辑/删除） */
export default function FolderCard({ folder, count, onOpen, onEdit, onDelete }: FolderCardProps) {
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

  /** 成员概况：所有者 + 成员数 */
  const owners = folder.members.filter((m) => m.role === 'owner')
  const memberCount = folder.members.length - owners.length
  const memberSummary = folder.members.length === 0
    ? '所有人可见'
    : `${owners.map((m) => m.name).join('、')} · ${memberCount} 名成员`

  return (
    <div className="folder-card" ref={rootRef}>
      <button type="button" className="folder-card-main" onClick={onOpen}>
        <span className="folder-stack" aria-hidden="true">
          <span className="folder-stack-back" />
          <span className="folder-stack-front">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          </span>
        </span>
        <span className="folder-card-name">{folder.name}</span>
        <span className="folder-card-count">{count} 个项目</span>
        <span className="folder-card-members" title={folder.members.length === 0 ? '未设置可见范围，所有人可见' : '可见成员范围'}>
          {memberSummary}
        </span>
      </button>

      <button
        type="button"
        className="folder-card-menu-btn"
        aria-label="文件夹操作"
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen((v) => !v)
        }}
      >
        ⋯
      </button>

      {menuOpen && (
        <div className="folder-card-menu" role="menu">
          <button
            type="button"
            className="folder-menu-item"
            onClick={() => {
              setMenuOpen(false)
              onEdit()
            }}
          >
            编辑文件夹
          </button>
          <button
            type="button"
            className="folder-menu-item danger"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
          >
            删除文件夹
          </button>
        </div>
      )}
    </div>
  )
}

