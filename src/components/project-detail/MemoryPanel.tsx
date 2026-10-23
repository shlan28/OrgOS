import { useEffect, useState } from 'react'
import type { Knowledge, MemoryItem, MemorySettings } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import Toggle from '../Toggle'
import { ChevronDownIcon } from '../icons'
import './MemoryPanel.css'

interface MemoryPanelProps {
  knowledge: Knowledge
  onUpdateKnowledge: (k: Knowledge) => void
}

const POLICIES: MemorySettings['expirePolicy'][] = ['自动归档', '自动删除', '仅提醒']
const REFLECT_FREQS: MemorySettings['reflectFrequency'][] = ['每天', '每周', '每月']

const lifecycleTone: Record<MemoryItem['lifecycle'], BadgeTone> = {
  活跃: 'success',
  即将过期: 'warning',
  已归档: 'neutral',
}

const nowStamp = () => {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 记忆规则弹窗左侧导航项（key 与右侧内容一一对应） */
const RULE_SECTIONS = [
  { key: 'collect', label: '自动收集' },
  { key: 'rules', label: '收集规则' },
  { key: 'policy', label: '保留策略' },
  { key: 'reflect', label: '反思规则' },
] as const

type RuleSectionKey = (typeof RULE_SECTIONS)[number]['key']

/**
 * 「记忆」独立 tab 面板（迁自原「知识记忆」tab 的记忆段）：
 * 记忆条目 CRUD 为主体；规则设置（自动收集 / 收集规则 / 保留策略 / 自动反思）收进「记忆规则」弹窗（左右结构）。
 */
export default function MemoryPanel({ knowledge, onUpdateKnowledge }: MemoryPanelProps) {
  const { memories, memorySettings } = knowledge
  // 规则弹窗（打开时以当前设置初始化草稿）
  const [rulesOpen, setRulesOpen] = useState(false)
  const [rulesDraft, setRulesDraft] = useState<MemorySettings>(memorySettings)
  // 弹窗左侧导航选中项（右侧只显示对应内容）
  const [ruleSection, setRuleSection] = useState<RuleSectionKey>('collect')
  // 记忆条目
  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const expiringCount = memories.filter((m) => m.lifecycle === '即将过期').length

  const daysValid = Number.isInteger(Number(rulesDraft.retentionDays))
    && Number(rulesDraft.retentionDays) >= 1
    && Number(rulesDraft.retentionDays) <= 3650
  const rulesSaveDisabled = !rulesDraft.permanent && !daysValid

  const openRules = () => {
    setRulesDraft({ ...memorySettings })
    setRuleSection('collect')
    setRulesOpen(true)
  }

  // Escape 关闭弹窗（与 FormModal 一致的 macOS 标准交互；草稿由 rulesDraft 承载不丢失）
  useEffect(() => {
    if (!rulesOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRulesOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rulesOpen])

  /** 保存规则：一次性写回 memorySettings */
  const handleSaveRules = () => {
    if (rulesSaveDisabled) return
    onUpdateKnowledge({
      ...knowledge,
      memorySettings: {
        ...memorySettings,
        autoCollect: rulesDraft.autoCollect,
        collectRules: rulesDraft.collectRules.trim(),
        retentionDays: rulesDraft.retentionDays,
        permanent: rulesDraft.permanent,
        expirePolicy: rulesDraft.expirePolicy,
        autoReflect: rulesDraft.autoReflect,
        reflectFrequency: rulesDraft.reflectFrequency,
        reflectRules: rulesDraft.reflectRules.trim(),
      },
    })
    setRulesOpen(false)
  }

  const handleAddMemory = () => {
    if (!newContent.trim()) return
    const item: MemoryItem = {
      id: `mem${Date.now()}`,
      content: newContent.trim(),
      source: '手动',
      createdAt: nowStamp(),
      lifecycle: '活跃',
    }
    onUpdateKnowledge({ ...knowledge, memories: [item, ...memories] })
    setAdding(false)
    setNewContent('')
  }

  const handleCleanExpired = () => {
    onUpdateKnowledge({
      ...knowledge,
      memories: memories.map((m) => m.lifecycle === '即将过期'
        ? { ...m, lifecycle: '已归档' as const, remainDays: undefined }
        : m),
    })
  }

  const handleDeleteMemory = (id: string) => {
    onUpdateKnowledge({ ...knowledge, memories: memories.filter((m) => m.id !== id) })
    setExpandedId(null)
  }

  return (
    <div className="memory-segment">
      {/* 记忆条目 */}
      <Section
        label={`记忆条目（${memories.length} 条 · ${expiringCount} 条即将过期）`}
        action={(
          <>
            <button type="button" className="text-btn" onClick={openRules}>记忆规则</button>
            <button type="button" className="text-btn" onClick={() => setAdding(true)}>+ 手动添加</button>
            <button
              type="button"
              className="text-btn"
              disabled={expiringCount === 0}
              title={expiringCount === 0 ? '没有可清理的条目' : '将即将过期的条目归档'}
              onClick={handleCleanExpired}
            >
              清理过期
            </button>
          </>
        )}
      >
        {memories.length === 0 && <div className="knowledge-empty">暂无记忆条目</div>}
        {memories.map((m) => {
          const expanded = expandedId === m.id
          const archived = m.lifecycle === '已归档'
          return (
            <Row
              key={m.id}
              className={`memory-row${expanded ? ' expandable' : ''}${archived ? ' archived' : ''}`}
              onClick={() => setExpandedId(expanded ? null : m.id)}
            >
              <span className="settings-row-main">
                <span className="settings-row-text">
                  <span className="settings-row-title">{m.content}</span>
                  <span className="settings-row-sub">
                    {m.source} · 收集于 {m.createdAt}
                    {m.lifecycle === '即将过期' && m.remainDays !== undefined ? ` · 剩 ${m.remainDays} 天` : ''}
                  </span>
                </span>
              </span>
              <span className="settings-row-right">
                <StatusBadge tone={lifecycleTone[m.lifecycle]}>{m.lifecycle}</StatusBadge>
                <ChevronDownIcon size={13} className={`knowledge-chevron${expanded ? ' open' : ''}`} />
              </span>
              {expanded && (
                <div className="memory-expand" onClick={(e) => e.stopPropagation()}>
                  <p className="knowledge-summary">{m.content}</p>
                  {m.reflectNote && (
                    <p className="reflect-note"><strong>AI 反思：</strong>{m.reflectNote}</p>
                  )}
                  <div className="memory-expand-actions">
                    <button type="button" className="text-btn danger" onClick={() => handleDeleteMemory(m.id)}>删除记忆</button>
                  </div>
                </div>
              )}
            </Row>
          )
        })}
      </Section>

      {/* 记忆规则弹窗：左右结构（左小标题 / 右内容），一次性保存写回 memorySettings */}
      {rulesOpen && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRulesOpen(false)
          }}
        >
          <div className="modal-box memory-rules-modal" role="dialog" aria-modal="true" aria-label="记忆规则">
            <div className="modal-head">
              <span className="modal-title">记忆规则</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setRulesOpen(false)}>×</button>
            </div>
            <div className="memory-rules-body">
              {/* 左：小标题导航列（可点击，切换右侧内容） */}
              <div className="memory-rules-nav" role="tablist">
                {RULE_SECTIONS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="tab"
                    aria-selected={ruleSection === s.key}
                    className={`memory-rules-nav-item${ruleSection === s.key ? ' active' : ''}`}
                    onClick={() => setRuleSection(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {/* 右：当前选中项的具体内容 */}
              <div className="memory-rules-content">
                {ruleSection === 'collect' && (
                  <div className="memory-rules-field">
                    <div className="memory-rules-field-label">自动收集</div>
                    <label className="policy-permanent">
                      <Toggle
                        checked={rulesDraft.autoCollect}
                        onChange={(next) => setRulesDraft({ ...rulesDraft, autoCollect: next })}
                      />
                      自动从会话收集记忆
                    </label>
                    <p className="memory-rules-hint">会话结束后自动提炼要点写入记忆。</p>
                  </div>
                )}
                {ruleSection === 'rules' && (
                  <div className="memory-rules-field">
                    <div className="memory-rules-field-label">收集规则</div>
                    <textarea
                      className="field-input rules-textarea"
                      value={rulesDraft.collectRules}
                      spellCheck={false}
                      disabled={!rulesDraft.autoCollect}
                      title={rulesDraft.autoCollect ? undefined : '自动收集已关闭'}
                      placeholder="如 只收集代码规范、架构决策相关的要点，忽略闲聊与临时调试内容"
                      onChange={(e) => setRulesDraft({ ...rulesDraft, collectRules: e.target.value })}
                    />
                    {!rulesDraft.autoCollect && <p className="memory-rules-hint">自动收集关闭时收集规则不生效。</p>}
                  </div>
                )}
                {ruleSection === 'policy' && (
                  <div className="memory-rules-field">
                    <div className="memory-rules-field-label">保留策略</div>
                    <div className="inline-edit-fields">
                      <input
                        className="field-input policy-days-input"
                        type="number"
                        min={1}
                        max={3650}
                        value={rulesDraft.retentionDays}
                        disabled={rulesDraft.permanent}
                        onChange={(e) => setRulesDraft({ ...rulesDraft, retentionDays: Number(e.target.value) })}
                      />
                      <span className="policy-days-unit">天</span>
                      <label className="policy-permanent">
                        <Toggle
                          checked={rulesDraft.permanent}
                          onChange={(next) => setRulesDraft({ ...rulesDraft, permanent: next })}
                        />
                        永久保留
                      </label>
                      <select
                        className="field-select"
                        value={rulesDraft.expirePolicy}
                        onChange={(e) => setRulesDraft({ ...rulesDraft, expirePolicy: e.target.value as MemorySettings['expirePolicy'] })}
                      >
                        {POLICIES.map((p) => <option key={p} value={p}>过期{p}</option>)}
                      </select>
                    </div>
                    {!daysValid && !rulesDraft.permanent && (
                      <p className="memory-rules-error">保留天数需为 1–3650 的整数</p>
                    )}
                  </div>
                )}
                {ruleSection === 'reflect' && (
                  <div className="memory-rules-field">
                    <div className="memory-rules-field-label">反思规则</div>
                    <div className="reflect-field">
                      <Toggle
                        checked={rulesDraft.autoReflect}
                        onChange={(next) => setRulesDraft({ ...rulesDraft, autoReflect: next })}
                      />
                      <span className="reflect-field-label">启用自动反思</span>
                      <span className="reflect-freq">
                        {REFLECT_FREQS.map((f) => (
                          <button
                            key={f}
                            type="button"
                            className={rulesDraft.reflectFrequency === f ? 'active' : ''}
                            onClick={() => setRulesDraft({ ...rulesDraft, reflectFrequency: f })}
                          >
                            {f}
                          </button>
                        ))}
                      </span>
                    </div>
                    <textarea
                      className="field-input reflect-textarea"
                      value={rulesDraft.reflectRules}
                      spellCheck={false}
                      placeholder="自定义反思规则（可选），如 与当前规范冲突或引用已废弃方案的记忆自动归档，关键链路经验保持活跃"
                      onChange={(e) => setRulesDraft({ ...rulesDraft, reflectRules: e.target.value })}
                    />
                    <p className="memory-rules-hint">
                      AI 将结合项目规范、知识库文档与近期会话，定期评估记忆时效性：过时的自动归档，仍有效的保持活跃。
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-btn" onClick={() => setRulesOpen(false)}>取消</button>
              <button type="button" className="btn-primary" disabled={rulesSaveDisabled} onClick={handleSaveRules}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <FormModal
          title="添加记忆"
          confirmText="添加"
          confirmDisabled={!newContent.trim()}
          onConfirm={handleAddMemory}
          onClose={() => { setAdding(false); setNewContent('') }}
        >
          <ModalField label="记忆内容">
            <textarea
              className="field-input memory-textarea"
              value={newContent}
              spellCheck={false}
              placeholder="如 支付回调需幂等处理；用户偏好简洁回复；部署前需跑全量回归……"
              onChange={(e) => setNewContent(e.target.value)}
            />
          </ModalField>
        </FormModal>
      )}
    </div>
  )
}
