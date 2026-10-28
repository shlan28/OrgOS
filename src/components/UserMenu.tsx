import { useEffect, useRef } from 'react'
import { GearIcon, LogoutIcon } from './icons'

interface UserMenuProps {
  /** 点击「设置」 */
  onOpenSettings: () => void
  /** 退出登录 */
  onLogout: () => void
}

/**
 * 侧边栏用户名向上弹出菜单（单项「设置」）。
 * 打开/关闭由父组件 Sidebar 控制（菜单开启态下用户区显示高亮）。
 */
export default function UserMenu({ onOpenSettings, onLogout }: UserMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  /** Escape 关闭 / 点击菜单外部关闭（同 Dropdown 范式） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 派发关闭：复用外部点击逻辑（点击菜单外 = 关闭）
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      }
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      // 用户区按钮本身由 Sidebar 处理 toggle；这里只处理「真外部」点击
      if (ref.current && !ref.current.contains(target) && !isUserArea(target)) {
        document.dispatchEvent(new CustomEvent('user-menu-close'))
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="user-menu" ref={ref} role="menu">
      <button
        type="button"
        className="um-item"
        role="menuitem"
        onClick={onOpenSettings}
      >
        <GearIcon size={14} />
        <span>设置</span>
      </button>
      <button
        type="button"
        className="um-item"
        role="menuitem"
        onClick={onLogout}
      >
        <LogoutIcon size={14} />
        <span>退出登录</span>
      </button>
    </div>
  )
}

/** 目标是否在用户区按钮内（命中则交给 Sidebar 的 toggle 逻辑） */
function isUserArea(target: Node): boolean {
  return target instanceof Element && !!target.closest('.sidebar-user')
}
