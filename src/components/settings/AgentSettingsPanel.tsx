import { useCallback, useEffect, useState } from 'react'
import type { UserSettings } from '../../data/settings'
import { CURRENT_USER, type AdeAgent } from '../../data/projects'
import type { RuntimeInfo, RuntimeProfile } from '../../lib/runtimeApi'
import { runtimeApi } from '../../lib/runtimeApi'
import { Section, Row } from '../SettingsRow'
import StatusBadge from '../StatusBadge'
import FormModal from '../FormModal'
import AdeSettingsModal from '../project-detail/AdeSettingsModal'
import RuntimeManager from './RuntimeManager'
import CreateAgentWizard from './CreateAgentWizard'
import { RobotIcon } from '../icons'

interface AgentSettingsPanelProps {
  settings: UserSettings
  onUpdateSettings: (updater: (s: UserSettings) => UserSettings) => void
  /** 运行时状态（DeepSeek Harness CLI / API Key） */
  runtime: RuntimeInfo | null
  onSaveRuntime: (patch: { deepseekApiKey?: string; deepseekBaseUrl?: string }) => Promise<void>
  onRefreshRuntime: () => void
}

/**
 * Agent 设置面板：运行时（模型服务）+ 我的 Agent + 默认模型 + 知识与上下文 + ADE.md。
 * 新建 Agent 走四步向导：运行时 → 名称 → 模型 → 个性化。
 */
export default function AgentSettingsPanel({
  settings, onUpdateSettings, runtime, onRefreshRuntime,
}: AgentSettingsPanelProps) {
  /** ADE 配置弹窗编辑对象 id（null = 关闭） */
  const [adeEditingId, setAdeEditingId] = useState<string | null>(null)
  /** 新建 Agent 向导 */
  const [wizardOpen, setWizardOpen] = useState(false)
  /** 待确认删除的 Agent（有会话时二次确认） */
  const [pendingRemove, setPendingRemove] = useState<AdeAgent | null>(null)
  /** 运行时列表（新建 Agent 时选择 + 模型列表来源） */
  const [runtimes, setRuntimes] = useState<RuntimeProfile[]>([])

  const loadRuntimes = useCallback(() => {
    runtimeApi.runtimes()
      .then(({ runtimes: list }) => setRuntimes(list))
      .catch(() => {})
  }, [])

  useEffect(loadRuntimes, [loadRuntimes])

  const editingAde = settings.myAdes.find((a) => a.id === adeEditingId) ?? null

  /* —— 写操作 —— */

  const patch = (p: Partial<UserSettings>) => onUpdateSettings((s) => ({ ...s, ...p }))

  /** 保存 ADE 配置弹窗（写回 myAdes） */
  const handleSaveAde = (next: AdeAgent) => {
    onUpdateSettings((s) => ({ ...s, myAdes: s.myAdes.map((a) => (a.id === next.id ? next : a)) }))
    setAdeEditingId(null)
  }

  /** 移除我的 ADE（有会话时二次确认） */
  const removeAde = (id: string) => {
    onUpdateSettings((s) => {
      const myAdes = s.myAdes.filter((a) => a.id !== id)
      const defaultAdeId = s.defaultAdeId === id ? myAdes[0]?.id ?? '' : s.defaultAdeId
      return { ...s, myAdes, defaultAdeId }
    })
    setAdeEditingId(null)
  }

  const handleRemoveAde = (id: string) => {
    const target = settings.myAdes.find((a) => a.id === id)
    if (target && (target.sessionCount ?? 0) > 0) {
      setAdeEditingId(null)
      setPendingRemove(target)
      return
    }
    removeAde(id)
  }

  /** 向导创建 Agent：写入列表（首个自动设为默认）并打开配置弹窗 */
  const handleCreateAgent = (ade: AdeAgent) => {
    onUpdateSettings((s) => ({
      ...s,
      myAdes: [...s.myAdes, ade],
      defaultAdeId: s.myAdes.length === 0 ? ade.id : s.defaultAdeId,
    }))
    setWizardOpen(false)
    setAdeEditingId(ade.id)
  }

  /* —— 渲染 —— */

  return (
    <div>
      <RuntimeManager
        runtime={runtime}
        runtimes={runtimes}
        onChanged={loadRuntimes}
        onRefreshRuntime={onRefreshRuntime}
      />

      {/* —— 我的 Agent —— */}
      <Section
        label={`我的 Agent（${settings.myAdes.length}）`}
        action={<button type="button" className="text-btn" onClick={() => setWizardOpen(true)}>＋ 新建 Agent</button>}
      >
        {settings.myAdes.length === 0 && (
          <Row><span className="settings-row-sub">暂无 Agent，点右上角新建</span></Row>
        )}
        {settings.myAdes.map((ade) => (
          <Row key={ade.id} onClick={() => setAdeEditingId(ade.id)} title="点击配置该 ADE">
            <div className="settings-row-main">
              <span className="ade-row-icon"><RobotIcon size={15} /></span>
              <span className="settings-row-text">
                <span className="settings-row-title">{ade.name}</span>
                <span className="settings-row-sub">
                  {ade.role || '未设置角色'} · {ade.model}
                  {(ade.sessionCount ?? 0) > 0 ? ` · ${ade.sessionCount} 个会话` : ''}
                  {ade.currentTask ? ` · 当前：${ade.currentTask}` : ''}
                </span>
              </span>
            </div>
            <div className="settings-row-right">
              <StatusBadge tone={ade.status === '工作中' ? 'warning' : 'success'}>{ade.status}</StatusBadge>
              {settings.defaultAdeId === ade.id ? (
                <span className="me-tag default-tag">默认</span>
              ) : (
                <button
                  type="button"
                  className="text-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    patch({ defaultAdeId: ade.id })
                  }}
                >
                  设为默认
                </button>
              )}
            </div>
          </Row>
        ))}
      </Section>

      {/* ADE 配置弹窗（复用项目详情页组件，零逻辑改动） */}
      {editingAde && (
        <AdeSettingsModal
          agent={editingAde}
          onSave={handleSaveAde}
          onRemove={handleRemoveAde}
          onClose={() => setAdeEditingId(null)}
        />
      )}

      {/* 新建 Agent 四步向导 */}
      {wizardOpen && (
        <CreateAgentWizard
          runtimes={runtimes}
          onClose={() => setWizardOpen(false)}
          onCreate={handleCreateAgent}
        />
      )}

      {/* 有会话的 Agent 删除确认 */}
      {pendingRemove && (
        <FormModal
          title="删除 Agent"
          confirmText="删除"
          confirmDanger
          onConfirm={() => {
            removeAde(pendingRemove.id)
            setPendingRemove(null)
          }}
          onClose={() => setPendingRemove(null)}
        >
          <p className="form-hint">
            「{pendingRemove.name}」名下有 {pendingRemove.sessionCount} 个会话。
          </p>
          <div className="form-tips">
            <span className="form-tips-icon">i</span>
            <span className="form-tips-text">
              删除 Agent 会一并删除这些会话及其消息记录，且不可恢复。
            </span>
          </div>
        </FormModal>
      )}

      {/* 当前用户徽标（占位，供视觉对齐校验） */}
      <p className="settings-current-user">
        当前用户：{CURRENT_USER.name} · 默认 ADE：{settings.myAdes.find((a) => a.id === settings.defaultAdeId)?.name ?? '未设置'}
      </p>
    </div>
  )
}
