import { useEffect, useRef, useState } from 'react'
import type { AdeAgent } from '../../data/projects'
import { ADE_LLM_BASES, ADE_MD_PLACEHOLDER, createDefaultAdeConfig } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import StatusBadge from '../StatusBadge'
import SegmentedControl from '../SegmentedControl'
import AdeSettingsModal from './AdeSettingsModal'
import { RobotIcon } from '../icons'
import './AgentsPanel.css'

interface AgentsPanelProps {
  agents: AdeAgent[]
  onUpdateAgents: (agents: AdeAgent[]) => void
}

/** 滚动到最近的可滚动祖先顶部 */
function scrollToTop(el: HTMLElement | null) {
  let node = el?.parentElement ?? null
  while (node) {
    if (node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0
      return
    }
    node = node.parentElement
  }
}

/**
 * 项目ADE 面板：分段切换「接入的 ADE / ADE 个性化」
 * - 段一：ADE 行（状态 + 当前任务）+ 申请专属ADE + 点击行弹出配置弹窗
 * - 段二：ADE 芯片切换 + ADE.md 编辑器
 */
export default function AgentsPanel({ agents, onUpdateAgents }: AgentsPanelProps) {
  const [segment, setSegment] = useState('list')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollToTop(rootRef.current)
  }, [segment])

  return (
    <div className="agents-panel" ref={rootRef}>
      <SegmentedControl
        value={segment}
        onChange={setSegment}
        items={[
          { key: 'list', label: '接入的 ADE', icon: null },
          { key: 'persona', label: 'ADE 个性化', icon: null },
        ]}
      />
      {segment === 'list'
        ? <AgentsSegment agents={agents} onUpdateAgents={onUpdateAgents} />
        : <PersonaSegment agents={agents} onUpdateAgents={onUpdateAgents} />}
    </div>
  )
}

/* ================= 段一：接入的 ADE（列表 + 配置弹窗） ================= */

function AgentsSegment({ agents, onUpdateAgents }: AgentsPanelProps) {
  const [applying, setApplying] = useState(false)
  const [form, setForm] = useState({ name: '', role: '' })
  /** 正在编辑配置的 ADE（null = 弹窗关闭） */
  const [editingId, setEditingId] = useState<string | null>(null)

  const editingAgent = agents.find((a) => a.id === editingId) ?? null

  const resetForm = () => setForm({ name: '', role: '' })

  const handleApply = () => {
    if (!form.name.trim()) return
    const a: AdeAgent = {
      id: `a${Date.now()}`,
      name: form.name.trim(),
      role: form.role.trim() || '研发工程师',
      model: ADE_LLM_BASES[0],
      status: '空闲',
      currentTask: '',
      ...createDefaultAdeConfig(),
    }
    onUpdateAgents([...agents, a])
    setApplying(false)
    resetForm()
  }

  const handleSaveConfig = (next: AdeAgent) => {
    onUpdateAgents(agents.map((a) => (a.id === next.id ? next : a)))
    setEditingId(null)
  }

  const handleRemove = (id: string) => {
    onUpdateAgents(agents.filter((a) => a.id !== id))
    setEditingId(null)
  }

  return (
    <>
      <Section
        label={`接入的 ADE（${agents.length} 个）`}
        action={<button type="button" className="text-btn" onClick={() => { setApplying(true); resetForm() }}>+ 申请专属ADE</button>}
      >
        {agents.length === 0 && <div className="agents-empty">暂无 ADE 接入本项目</div>}
        {agents.map((a) => {
          const busy = a.status === '工作中'
          return (
            <Row
              key={a.id}
              className="agent-row"
              onClick={() => {
                if (busy) return // 工作中的 ADE 不可编辑
                setEditingId(a.id)
              }}
              title={busy ? '工作中的 ADE 不可修改' : undefined}
            >
              <span className="settings-row-main">
                <span className="settings-row-text">
                  <span className="settings-row-title">{a.name}</span>
                  <span className="settings-row-sub">
                    {a.role} · {a.model}
                    {' · 当前：'}
                    {busy ? a.currentTask : '—'}
                  </span>
                </span>
              </span>
              <span className="settings-row-right">
                <StatusBadge tone={busy ? 'info' : 'neutral'}>{a.status}</StatusBadge>
              </span>
            </Row>
          )
        })}
      </Section>

      {applying && (
        <FormModal
          title="申请专属ADE"
          confirmText="申请"
          confirmDisabled={!form.name.trim()}
          onConfirm={handleApply}
          onClose={() => { setApplying(false); resetForm() }}
        >
          <ModalField label="ADE 名称">
            <input className="field-input" value={form.name} placeholder="如 研发工程师ADE" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </ModalField>
          <ModalField label="角色">
            <input className="field-input" value={form.role} placeholder="研发工程师/测试工程师…" onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </ModalField>
        </FormModal>
      )}

      {editingAgent && (
        <AdeSettingsModal
          agent={editingAgent}
          onSave={handleSaveConfig}
          onRemove={handleRemove}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  )
}

/* ================= 段二：ADE 个性化（芯片 + ADE.md 编辑器） ================= */

function PersonaSegment({ agents, onUpdateAgents }: AgentsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(agents[0]?.id ?? null)
  const [draft, setDraft] = useState(agents[0]?.adeMd ?? '')

  const selected = agents.find((a) => a.id === selectedId) ?? null
  const dirty = selected != null && draft !== selected.adeMd

  /** 切换芯片：草稿重置为目标 ADE 已保存内容 */
  const handleSelect = (id: string) => {
    if (id === selectedId) return
    setSelectedId(id)
    setDraft(agents.find((a) => a.id === id)?.adeMd ?? '')
  }

  const handleSave = () => {
    if (!selected || !draft.trim()) return
    onUpdateAgents(agents.map((a) => (a.id === selected.id ? { ...a, adeMd: draft } : a)))
  }

  const handleCancel = () => {
    if (selected) setDraft(selected.adeMd)
  }

  if (!selected) {
    return <div className="agents-empty persona-empty">暂无 ADE，请先在「接入的 ADE」中申请</div>
  }

  return (
    <div className="persona-panel">
      {/* ADE 芯片行 */}
      <div className="persona-chips">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`persona-chip${a.id === selectedId ? ' active' : ''}`}
            onClick={() => handleSelect(a.id)}
          >
            <RobotIcon size={13} />
            {a.name}
          </button>
        ))}
      </div>

      {/* ADE.md 编辑器 */}
      <div className="persona-field">
        <span className="persona-field-label">ADE.md<span className="persona-required">*</span></span>
        <textarea
          className="persona-editor"
          value={draft}
          spellCheck={false}
          placeholder={ADE_MD_PLACEHOLDER}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>

      {/* 底部操作 */}
      <div className="persona-actions">
        <span className="persona-dirty-hint">{dirty ? '有未保存的修改' : ''}</span>
        <span className="persona-btns">
          <button type="button" className="text-btn" disabled={!dirty} onClick={handleCancel}>取消</button>
          <button type="button" className="btn-primary" disabled={!dirty || !draft.trim()} onClick={handleSave}>保存</button>
        </span>
      </div>
    </div>
  )
}
