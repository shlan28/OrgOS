import { useCallback, useEffect, useState } from 'react'
import {
  memoryApi,
  type MemoryCounts,
  type MemoryRecord,
  type MemorySettingsDto,
} from '../../lib/memoryApi'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import Toggle from '../Toggle'
import { ChevronDownIcon } from '../icons'
import './MemoryPanel.css'

interface MemoryPanelProps {
  projectId: string
  onSettingsChange?: (settings: MemorySettingsDto) => void
}

const REFLECT_FREQS: MemorySettingsDto['reflectFrequency'][] = ['每天', '每周', '每月']

const POLICIES: {
  value: MemorySettingsDto['expirePolicy']
  label: string
  desc: string
  summary: string
  recommended?: boolean
}[] = [
  {
    value: '自动归档',
    label: '自动归档',
    desc: '不再参与会话，仍可在「已归档」中查看',
    summary: '自动归档：不再参与会话，但仍可在「已归档」中查看。',
    recommended: true,
  },
  {
    value: '自动删除',
    label: '自动删除',
    desc: '从列表移除，不再参与会话',
    summary: '自动删除：从列表移除，不再参与会话。',
  },
  {
    value: '仅提醒',
    label: '仅提醒',
    desc: '保留在列表并标为「即将过期」，由你手动处理',
    summary: '保留在列表并标记为「即将过期」，由你手动处理。',
  },
]

const lifecycleTone: Record<MemoryRecord['lifecycle'], BadgeTone> = {
  活跃: 'success',
  即将过期: 'warning',
  已归档: 'neutral',
}

/** 记忆规则弹窗左侧导航项（key 与右侧内容一一对应） */
const RULE_SECTIONS = [
  { key: 'collect', label: '自动收集' },
  { key: 'rules', label: '收集规则' },
  { key: 'policy', label: '保留策略' },
  { key: 'reflect', label: '反思规则' },
  { key: 'inject', label: '会话使用' },
] as const

type RuleSectionKey = (typeof RULE_SECTIONS)[number]['key']

const EMPTY_SETTINGS: MemorySettingsDto = {
  autoCollect: true,
  injectMemory: true,
  collectRules: '',
  collectEvery: 5,
  retentionDays: 90,
  permanent: false,
  expirePolicy: '自动归档',
  autoReflect: false,
  reflectFrequency: '每周',
  reflectRules: '',
  updatedAt: '',
}

const msgOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

const stampOf = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 「记忆」独立 tab：记忆条目 CRUD 为主体；规则设置收进「记忆规则」弹窗。
 * 数据全部来自 /api/projects/:id/memories 与 /memory-settings。
 */
export default function MemoryPanel({ projectId, onSettingsChange }: MemoryPanelProps) {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [counts, setCounts] = useState<MemoryCounts>({ total: 0, expiring: 0, archived: 0 })
  const [settings, setSettings] = useState<MemorySettingsDto>(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionNote, setActionNote] = useState('')

  const [rulesOpen, setRulesOpen] = useState(false)
  const [rulesDraft, setRulesDraft] = useState<MemorySettingsDto>(EMPTY_SETTINGS)
  const [ruleSection, setRuleSection] = useState<RuleSectionKey>('collect')
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesError, setRulesError] = useState('')
  const [collecting, setCollecting] = useState(false)

  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const [list, settingsRes] = await Promise.all([
        memoryApi.list(projectId),
        memoryApi.settings(projectId),
      ])
      setMemories(list.memories)
      setCounts(list.counts)
      setSettings(settingsRes.settings)
    } catch (err) {
      setError(msgOf(err, '加载记忆失败'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setMemories([])
    setCounts({ total: 0, expiring: 0, archived: 0 })
    setSettings(EMPTY_SETTINGS)
    setExpandedId(null)
    setActionNote('')
    void load()
  }, [load])

  // Escape 关闭规则弹窗
  useEffect(() => {
    if (!rulesOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRulesOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rulesOpen])

  const daysValid = Number.isInteger(Number(rulesDraft.retentionDays))
    && Number(rulesDraft.retentionDays) >= 1
    && Number(rulesDraft.retentionDays) <= 3650
  const collectEveryValid = Number.isInteger(Number(rulesDraft.collectEvery))
    && Number(rulesDraft.collectEvery) >= 1
    && Number(rulesDraft.collectEvery) <= 50
  const rulesSaveDisabled = (!rulesDraft.permanent && !daysValid) || !collectEveryValid

  const policyOption = POLICIES.find((item) => item.value === rulesDraft.expirePolicy) ?? POLICIES[0]
  const policySummary = rulesDraft.permanent
    ? '记忆将永久保留，不会自动归档或删除。'
    : `创建 ${rulesDraft.retentionDays} 天后，记忆将${policyOption.summary}`

  const openRules = () => {
    setRulesDraft({ ...settings })
    setRuleSection('collect')
    setRulesError('')
    setRulesOpen(true)
  }

  const handleSaveRules = async () => {
    if (rulesSaveDisabled || rulesSaving) return
    setRulesSaving(true)
    setRulesError('')
    try {
      const { settings: next } = await memoryApi.saveSettings(projectId, {
        autoCollect: rulesDraft.autoCollect,
        injectMemory: rulesDraft.injectMemory,
        collectRules: rulesDraft.collectRules.trim(),
        collectEvery: Number(rulesDraft.collectEvery),
        retentionDays: Number(rulesDraft.retentionDays),
        permanent: rulesDraft.permanent,
        expirePolicy: rulesDraft.expirePolicy,
        autoReflect: rulesDraft.autoReflect,
        reflectFrequency: rulesDraft.reflectFrequency,
        reflectRules: rulesDraft.reflectRules.trim(),
      })
      setSettings(next)
      onSettingsChange?.(next)
      setRulesOpen(false)
      void load(false)
    } catch (err) {
      setRulesError(msgOf(err, '保存失败'))
    } finally {
      setRulesSaving(false)
    }
  }

  const handleAddMemory = async () => {
    if (!newContent.trim() || addSaving) return
    setAddSaving(true)
    setAddError('')
    try {
      await memoryApi.create(projectId, newContent.trim())
      setAdding(false)
      setNewContent('')
      await load(false)
    } catch (err) {
      setAddError(msgOf(err, '添加失败'))
    } finally {
      setAddSaving(false)
    }
  }

  const handleDeleteMemory = async (id: string) => {
    setActionNote('')
    try {
      await memoryApi.remove(projectId, id)
      setExpandedId(null)
      await load(false)
    } catch (err) {
      setActionNote(msgOf(err, '删除失败'))
    }
  }

  const handleCleanExpired = async () => {
    setActionNote('')
    try {
      const { archived } = await memoryApi.archiveExpired(projectId)
      setActionNote(archived > 0 ? `已归档 ${archived} 条` : '没有可清理的条目')
      await load(false)
    } catch (err) {
      setActionNote(msgOf(err, '清理失败'))
    }
  }

  const handleCollect = async () => {
    if (collecting) return
    setCollecting(true)
    setActionNote('')
    try {
      const result = await memoryApi.collect(projectId)
      setActionNote(result.queued ? '已开始收集，稍后刷新列表查看' : '已有收集任务在运行')
    } catch (err) {
      setActionNote(msgOf(err, '收集失败'))
    } finally {
      setCollecting(false)
    }
  }

  return (
    <div className="memory-segment">
      <Section
        label={`记忆条目（${counts.total} 条 · ${counts.expiring} 条即将过期）`}
        action={(
          <>
            <button type="button" className="text-btn" onClick={openRules}>记忆规则</button>
            <button type="button" className="text-btn" onClick={() => setAdding(true)}>+ 手动添加</button>
            <button
              type="button"
              className="text-btn"
              disabled={counts.expiring === 0}
              title={counts.expiring === 0 ? '没有可清理的条目' : '将即将过期的条目归档'}
              onClick={() => void handleCleanExpired()}
            >
              清理过期
            </button>
          </>
        )}
      >
        {loading && <div className="knowledge-empty">加载中…</div>}
        {!loading && error && (
          <div className="knowledge-empty">
            {error}
            {' '}
            <button type="button" className="text-btn" onClick={() => void load()}>重试</button>
          </div>
        )}
        {!loading && !error && memories.length === 0 && <div className="knowledge-empty">暂无记忆条目</div>}
        {actionNote && <p className="memory-rules-hint">{actionNote}</p>}
        {!loading && !error && memories.map((memory) => {
          const expanded = expandedId === memory.id
          const archived = memory.lifecycle === '已归档'
          return (
            <Row
              key={memory.id}
              className={`memory-row${expanded ? ' expandable' : ''}${archived ? ' archived' : ''}`}
              onClick={() => setExpandedId(expanded ? null : memory.id)}
            >
              <span className="settings-row-main">
                <span className="settings-row-text">
                  <span className="settings-row-title">{memory.content}</span>
                  <span className="settings-row-sub">
                    {memory.source} · 收集于 {stampOf(memory.createdAt)}
                    {memory.lifecycle === '即将过期' && memory.remainDays !== undefined
                      ? ` · 剩 ${memory.remainDays} 天`
                      : ''}
                  </span>
                </span>
              </span>
              <span className="settings-row-right">
                <StatusBadge tone={lifecycleTone[memory.lifecycle]}>{memory.lifecycle}</StatusBadge>
                <ChevronDownIcon size={13} className={`knowledge-chevron${expanded ? ' open' : ''}`} />
              </span>
              {expanded && (
                <div className="memory-expand" onClick={(event) => event.stopPropagation()}>
                  <p className="knowledge-summary">{memory.content}</p>
                  {memory.reflectNote && (
                    <p className="reflect-note"><strong>AI 反思：</strong>{memory.reflectNote}</p>
                  )}
                  <div className="memory-expand-actions">
                    <button
                      type="button"
                      className="text-btn danger"
                      onClick={() => void handleDeleteMemory(memory.id)}
                    >
                      删除记忆
                    </button>
                  </div>
                </div>
              )}
            </Row>
          )
        })}
      </Section>

      {rulesOpen && (
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRulesOpen(false)
          }}
        >
          <div className="modal-box memory-rules-modal" role="dialog" aria-modal="true" aria-label="记忆规则">
            <div className="modal-head">
              <span className="modal-title">记忆规则</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setRulesOpen(false)}>×</button>
            </div>
            <div className="memory-rules-body">
              <div className="memory-rules-nav" role="tablist">
                {RULE_SECTIONS.map((section) => (
                  <button
                    key={section.key}
                    type="button"
                    role="tab"
                    aria-selected={ruleSection === section.key}
                    className={`memory-rules-nav-item${ruleSection === section.key ? ' active' : ''}`}
                    onClick={() => setRuleSection(section.key)}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
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
                    <div className="policy-days-row">
                      <span className="collect-every-label">每个会话每累计</span>
                      <input
                        className="field-input collect-every-input"
                        type="number"
                        min={1}
                        max={50}
                        value={rulesDraft.collectEvery}
                        disabled={!rulesDraft.autoCollect}
                        onChange={(event) => setRulesDraft({ ...rulesDraft, collectEvery: Number(event.target.value) })}
                      />
                      <span className="collect-every-label">轮对话提炼一次</span>
                    </div>
                    <p className="memory-rules-hint">
                      不足 {rulesDraft.collectEvery || 5} 轮时不会自动收集，可点下方「立即收集」，或等对话继续。
                    </p>
                    <div className="memory-collect-row">
                      <button
                        type="button"
                        className="text-btn"
                        disabled={collecting}
                        onClick={() => void handleCollect()}
                      >
                        {collecting ? '收集中…' : '立即收集一次'}
                      </button>
                      <span className="memory-rules-hint">自动收集关闭时仍可手动触发</span>
                    </div>
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
                      onChange={(event) => setRulesDraft({ ...rulesDraft, collectRules: event.target.value })}
                    />
                    {!rulesDraft.autoCollect && <p className="memory-rules-hint">自动收集关闭时收集规则不生效。</p>}
                  </div>
                )}

                {ruleSection === 'policy' && (
                  <div className="memory-rules-field">
                    <div className="memory-rules-field-label">保留策略</div>
                    <p className="memory-rules-hint">
                      时间规则负责兜底：记忆到期后按下面的方式处理。
                      开启「反思规则」后，AI 还会结合项目内容提前归档过时记忆。
                    </p>
                    <div className="policy-card">
                      <div className="policy-days-row">
                        <input
                          className="field-input policy-days-input"
                          type="number"
                          min={1}
                          max={3650}
                          value={rulesDraft.retentionDays}
                          disabled={rulesDraft.permanent}
                          onChange={(event) => setRulesDraft({ ...rulesDraft, retentionDays: Number(event.target.value) })}
                        />
                        <span className="policy-days-unit">天</span>
                        <span className="policy-input-hint">1–3650 天</span>
                        <label className="policy-permanent">
                          <Toggle
                            checked={rulesDraft.permanent}
                            onChange={(next) => setRulesDraft({ ...rulesDraft, permanent: next })}
                          />
                          永久保留
                        </label>
                      </div>
                    </div>
                    <div className="policy-card" role="radiogroup" aria-label="到期后">
                      {POLICIES.map((option) => {
                        const selected = rulesDraft.expirePolicy === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={rulesDraft.permanent}
                            className={`policy-option${selected ? ' selected' : ''}${rulesDraft.permanent ? ' disabled' : ''}`}
                            onClick={() => setRulesDraft({ ...rulesDraft, expirePolicy: option.value })}
                          >
                            <span className="policy-option-radio" aria-hidden="true" />
                            <span className="policy-option-body">
                              <span className="policy-option-title">
                                {option.label}
                                {option.recommended && <span className="policy-recommend">推荐</span>}
                              </span>
                              <span className="policy-option-desc">{option.desc}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {!daysValid && !rulesDraft.permanent && (
                      <p className="memory-rules-error">保留天数需为 1–3650 的整数</p>
                    )}
                    <p className="policy-summary">{policySummary}</p>
                    <p className="memory-rules-hint">不确定选哪个？保持默认「自动归档」即可，不会丢失数据。</p>
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
                        {REFLECT_FREQS.map((frequency) => (
                          <button
                            key={frequency}
                            type="button"
                            disabled={!rulesDraft.autoReflect}
                            className={rulesDraft.reflectFrequency === frequency ? 'active' : ''}
                            onClick={() => setRulesDraft({ ...rulesDraft, reflectFrequency: frequency })}
                          >
                            {frequency}
                          </button>
                        ))}
                      </span>
                    </div>
                    <textarea
                      className="field-input reflect-textarea"
                      value={rulesDraft.reflectRules}
                      spellCheck={false}
                      disabled={!rulesDraft.autoReflect}
                      placeholder="自定义反思规则（可选），如 与当前规范冲突或引用已废弃方案的记忆自动归档，关键链路经验保持活跃"
                      onChange={(event) => setRulesDraft({ ...rulesDraft, reflectRules: event.target.value })}
                    />
                    <p className="memory-rules-hint">
                      AI 将结合项目规范、知识库文档与近期会话，定期评估记忆时效性：过时的自动归档，仍有效的保持活跃。
                    </p>
                  </div>
                )}

                {ruleSection === 'inject' && (
                  <div className="memory-rules-field">
                    <div className="memory-rules-field-label">会话使用</div>
                    <label className="policy-permanent">
                      <Toggle
                        checked={rulesDraft.injectMemory}
                        onChange={(next) => setRulesDraft({ ...rulesDraft, injectMemory: next })}
                      />
                      每轮对话自动注入相关记忆
                    </label>
                    <p className="memory-rules-hint">
                      默认开启。关闭后不再向会话注入记忆，但记忆仍会保留并可在本页查看。
                    </p>
                  </div>
                )}

                {rulesError && <p className="memory-rules-error">{rulesError}</p>}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-btn" onClick={() => setRulesOpen(false)}>取消</button>
              <button type="button" className="btn-primary" disabled={rulesSaveDisabled || rulesSaving} onClick={() => void handleSaveRules()}>
                {rulesSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <FormModal
          title="添加记忆"
          confirmText={addSaving ? '添加中…' : '添加'}
          confirmDisabled={!newContent.trim() || addSaving}
          onConfirm={() => void handleAddMemory()}
          onClose={() => { setAdding(false); setNewContent(''); setAddError('') }}
        >
          <ModalField label="记忆内容">
            <textarea
              className="field-input memory-textarea"
              value={newContent}
              spellCheck={false}
              placeholder="如 支付回调需幂等处理；用户偏好简洁回复；部署前需跑全量回归……"
              onChange={(event) => setNewContent(event.target.value)}
            />
          </ModalField>
          {addError && <p className="memory-rules-error">{addError}</p>}
        </FormModal>
      )}
    </div>
  )
}
