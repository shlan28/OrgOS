import { useEffect, useRef, useState } from 'react'
import type {
  SecurityData, SecurityRule, ReviewRecord, RuleFinding,
  RuleSeverity, RuleMatchType,
} from '../../data/security'
import {
  SCAN_SCOPES, RULE_SEVERITIES, RULE_MATCH_TYPES, RULE_SCOPES,
  SCHEDULE_FREQS, HOUR_OPTIONS, MINUTE_OPTIONS, WEEKDAY_OPTIONS, DAY_OPTIONS,
  WEEKDAY_NAMES, securityScheduleText,
  buildReviewRecord, findingStats, findingStatsText, nowStamp,
} from '../../data/security'
import type { SecuritySchedule } from '../../data/security'
import { Section, Row } from '../SettingsRow'
import SegmentedControl from '../SegmentedControl'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import Toggle from '../Toggle'
import FormModal, { ModalField } from '../FormModal'
import { ChevronDownIcon, HelpIcon, ShieldIcon } from '../icons'
import './SecurityPanel.css'

/** 严重度 → 徽标色 */
const sevTone: Record<RuleSeverity, BadgeTone> = {
  高危: 'danger',
  中危: 'warning',
  低危: 'info',
  提示: 'neutral',
}

/** 触发方式 → 徽标色 */
const triggerTone: Record<ReviewRecord['trigger'], BadgeTone> = {
  手动: 'info',
  定时: 'neutral',
  MR: 'success',
}

/** 匹配方式 → 徽标色 */
const matchTone: Record<RuleMatchType, BadgeTone> = {
  关键词: 'info',
  正则: 'neutral',
}

/** 分段说明文案 */
const SEG_HINT: Record<string, string> = {
  rules: '预设安全规则开箱即用，可停用；自定义规则支持关键词 / 正则匹配',
  records: '手动立即审查，或设定定时审查到点自动执行',
}

/** 新建/编辑规则表单 */
interface RuleForm {
  name: string
  severity: RuleSeverity
  matchType: RuleMatchType
  pattern: string
  scope: string
  description: string
}

const emptyRuleForm = (): RuleForm => ({
  name: '', severity: '中危', matchType: '关键词', pattern: '', scope: RULE_SCOPES[0], description: '',
})

interface SecurityPanelProps {
  security: SecurityData
  /** 审查范围文案（主仓 · 分支） */
  scope: string
  onUpdateSecurity: (s: SecurityData) => void
}

/**
 * 安全审查面板：
 * 顶部扫描/阻断策略紧凑条（切段不隐藏）→ 分段切换（审查规则 / 审查记录）
 * 规则段 = 预设安全规则（仅启停）+ 自定义规则（增删改启停）
 * 记录段 = 立即审查 + 记录列表（展开问题明细 + 状态流转）
 */
export default function SecurityPanel({ security, scope, onUpdateSecurity }: SecurityPanelProps) {
  const [segment, setSegment] = useState<'rules' | 'records'>('rules')
  const rootRef = useRef<HTMLDivElement>(null)

  // 切段回到顶部（同 KnowledgePanel）
  useEffect(() => {
    let node = rootRef.current?.parentElement ?? null
    while (node) {
      if (node.scrollHeight > node.clientHeight) {
        node.scrollTop = 0
        return
      }
      node = node.parentElement
    }
  }, [segment])

  /* —— 写操作 —— */

  const updatePolicy = (patch: Partial<SecurityData['policy']>) => {
    onUpdateSecurity({ ...security, policy: { ...security.policy, ...patch } })
  }

  const toggleRule = (id: string, next: boolean) => {
    onUpdateSecurity({
      ...security,
      rules: security.rules.map((r) => (r.id === id ? { ...r, enabled: next } : r)),
    })
  }

  const addRule = (form: RuleForm) => {
    const rule: SecurityRule = {
      id: `cr${Date.now()}`,
      name: form.name.trim(),
      tag: '自定义',
      severity: form.severity,
      description: form.description.trim(),
      matchType: form.matchType,
      pattern: form.pattern.trim(),
      scope: form.scope,
      enabled: true,
      builtin: false,
    }
    onUpdateSecurity({ ...security, rules: [...security.rules, rule] })
  }

  const editRule = (id: string, form: RuleForm) => {
    onUpdateSecurity({
      ...security,
      rules: security.rules.map((r) => (r.id === id
        ? {
            ...r,
            name: form.name.trim(),
            severity: form.severity,
            description: form.description.trim(),
            matchType: form.matchType,
            pattern: form.pattern.trim(),
            scope: form.scope,
          }
        : r)),
    })
  }

  const removeRule = (id: string) => {
    onUpdateSecurity({ ...security, rules: security.rules.filter((r) => r.id !== id) })
  }

  /** 执行审查：按当前启用规则生成记录并置顶，返回新记录 id */
  const runReview = (trigger: ReviewRecord['trigger'] = '手动', startedAt?: string): string => {
    const record = buildReviewRecord(security.rules, scope, security.records.length, trigger, startedAt)
    onUpdateSecurity({ ...security, records: [record, ...security.records] })
    return record.id
  }

  const handleFinding = (recordId: string, findingId: string, status: RuleFinding['status']) => {
    onUpdateSecurity({
      ...security,
      records: security.records.map((rec) => (rec.id === recordId
        ? {
            ...rec,
            findings: rec.findings.map((f) => (f.id === findingId
              ? { ...f, status, handledAt: status === '待处理' ? undefined : nowStamp() }
              : f)),
          }
        : rec)),
    })
  }

  const presetRules = security.rules.filter((r) => r.builtin)
  const customRules = security.rules.filter((r) => !r.builtin)
  const enabledCount = security.rules.filter((r) => r.enabled).length
  /** 规则名映射（问题明细展示用） */
  const ruleNameMap = new Map(security.rules.map((r) => [r.id, r.name]))

  /**
   * 保存定时审查：单次 onUpdateSecurity 同时更新 policy 与记录。
   * 不可拆成「更新 policy + onRun 生成记录」两次调用——两次都基于同一旧 security 快照，
   * 后一次会把前一次的 policy 更新覆盖掉（曾导致保存开启后入口仍显示「未开启」）。
   * 从关到开时模拟一次到点执行（生成「定时」记录置顶），返回新记录 id。
   */
  const saveSchedule = (enabled: boolean, schedule: SecuritySchedule): string | null => {
    const wasEnabled = security.policy.scheduledReview
    const record = enabled && !wasEnabled && enabledCount > 0
      ? buildReviewRecord(security.rules, scope, security.records.length, '定时', `${nowStamp().slice(0, 5)} ${schedule.time}`)
      : null
    onUpdateSecurity({
      ...security,
      policy: { ...security.policy, scheduledReview: enabled, schedule },
      records: record ? [record, ...security.records] : security.records,
    })
    return record ? record.id : null
  }

  return (
    <div className="security-panel" ref={rootRef}>
      {/* ① 扫描/阻断策略紧凑条（面板最顶部，切段不隐藏）；策略名带问号图标，hover 浮层解释 */}
      <div className="policy-bar">
        <div className="policy-cell">
          <span className="policy-label">
            <span className="policy-name">MR 阻断</span>
            <span className="policy-help" tabIndex={0} role="note">
              <HelpIcon size={13} />
              <span className="policy-help-tip">开启后，审查发现高危问题时将阻断合并请求（MR），问题修复或确认忽略后方可合并</span>
            </span>
          </span>
          <Toggle checked={security.policy.blockMrOnHigh} onChange={(v) => updatePolicy({ blockMrOnHigh: v })} />
        </div>
        <div className="policy-cell">
          <span className="policy-label">
            <span className="policy-name">自动创建 Issue</span>
            <span className="policy-help" tabIndex={0} role="note">
              <HelpIcon size={13} />
              <span className="policy-help-tip">开启后，发现高危问题时自动在 GitLab 创建对应 Issue，指派给问题引入者跟进修复</span>
            </span>
          </span>
          <Toggle checked={security.policy.autoIssue} onChange={(v) => updatePolicy({ autoIssue: v })} />
        </div>
        <div className="policy-cell">
          <span className="policy-label">
            <span className="policy-name">扫描范围</span>
            <span className="policy-help" tabIndex={0} role="note">
              <HelpIcon size={13} />
              <span className="policy-help-tip">全量：每日对整个仓库扫描一遍；增量：仅扫描 MR 变更文件；全量+增量：两者结合，覆盖最全</span>
            </span>
          </span>
          <select
            className="policy-select"
            value={security.policy.scanScope}
            onChange={(e) => updatePolicy({ scanScope: e.target.value as SecurityData['policy']['scanScope'] })}
          >
            {SCAN_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* ② 分段切换 */}
      <div className="security-seg">
        <SegmentedControl
          value={segment}
          onChange={(k) => setSegment(k as 'rules' | 'records')}
          items={[
            { key: 'rules', label: `审查规则（${security.rules.length}）`, icon: null },
            { key: 'records', label: `审查记录（${security.records.length}）`, icon: null },
          ]}
        />
        <p className="security-seg-hint">{SEG_HINT[segment]}</p>
      </div>

      {segment === 'rules' ? (
        <RulesSegment
          presetRules={presetRules}
          customRules={customRules}
          enabledCount={enabledCount}
          onToggleRule={toggleRule}
          onAddRule={addRule}
          onEditRule={editRule}
          onRemoveRule={removeRule}
        />
      ) : (
        <RecordsSegment
          records={security.records}
          enabledCount={enabledCount}
          ruleNameMap={ruleNameMap}
          policy={security.policy}
          onSaveSchedule={saveSchedule}
          onRun={runReview}
          onHandleFinding={handleFinding}
        />
      )}
    </div>
  )
}

/* ================= 段一：审查规则 ================= */

interface RulesSegmentProps {
  presetRules: SecurityRule[]
  customRules: SecurityRule[]
  enabledCount: number
  onToggleRule: (id: string, next: boolean) => void
  onAddRule: (form: RuleForm) => void
  onEditRule: (id: string, form: RuleForm) => void
  onRemoveRule: (id: string) => void
}

function RulesSegment({
  presetRules, customRules, enabledCount, onToggleRule, onAddRule, onEditRule, onRemoveRule,
}: RulesSegmentProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 新建/编辑弹窗（editingId = null 表示新建）
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyRuleForm())

  const presetEnabled = presetRules.filter((r) => r.enabled).length

  const openCreateModal = () => {
    setEditingId(null)
    setForm(emptyRuleForm())
    setModalOpen(true)
  }

  const openEditModal = (rule: SecurityRule) => {
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      severity: rule.severity,
      matchType: rule.matchType,
      pattern: rule.pattern,
      scope: rule.scope,
      description: rule.description,
    })
    setModalOpen(true)
  }

  /** 正则合法性校验（支持 · 分隔的多段示意写法，逐段校验） */
  const regexInvalid = form.matchType === '正则' && form.pattern.trim() !== '' && (() => {
    try {
      const parts = form.pattern.split('·').map((s) => s.trim()).filter(Boolean)
      if (parts.length === 0) return false
      parts.forEach((p) => { new RegExp(p) })
      return false
    } catch {
      return true
    }
  })()

  const nameTaken = customRules.some((r) => r.id !== editingId && r.name === form.name.trim())
  const confirmDisabled = !form.name.trim() || !form.pattern.trim() || nameTaken || regexInvalid

  const handleConfirm = () => {
    if (confirmDisabled) return
    if (editingId) onEditRule(editingId, form)
    else onAddRule(form)
    setModalOpen(false)
  }

  /** 渲染一条规则行（预设 + 自定义共用） */
  const renderRuleRow = (rule: SecurityRule) => {
    const expanded = expandedId === rule.id
    return (
      <Row
        key={rule.id}
        className={`security-rule-row${expanded ? ' open' : ''}`}
        onClick={() => setExpandedId(expanded ? null : rule.id)}
      >
        <span className="settings-row-main">
          <span className="settings-row-text">
            <span className="settings-row-title">
              <span className="rule-name">{rule.name}</span>
              {rule.builtin && <StatusBadge tone="neutral">{rule.tag}</StatusBadge>}
              <StatusBadge tone={sevTone[rule.severity]}>{rule.severity}</StatusBadge>
              {!rule.builtin && <StatusBadge tone={matchTone[rule.matchType]}>{rule.matchType}</StatusBadge>}
            </span>
            <span className="settings-row-sub">
              {rule.description || '（未填写说明）'}{!rule.builtin ? ` · ${rule.scope}` : ''}
            </span>
          </span>
        </span>
        <span className="settings-row-right">
          <span role="presentation" onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
            <Toggle checked={rule.enabled} onChange={(v) => onToggleRule(rule.id, v)} />
          </span>
          {!rule.builtin && (
            <>
              <button
                type="button"
                className="text-btn"
                onClick={(e) => { e.stopPropagation(); openEditModal(rule) }}
              >
                编辑
              </button>
              <button
                type="button"
                className="text-btn danger"
                onClick={(e) => { e.stopPropagation(); onRemoveRule(rule.id) }}
              >
                移除
              </button>
            </>
          )}
          <span className={`rule-chevron${expanded ? ' open' : ''}`}>
            <ChevronDownIcon size={13} />
          </span>
        </span>

        {/* 展开区：匹配方式 / 规则内容 / 适用范围 */}
        {expanded && (
          <div className="rule-expand" onClick={(e) => e.stopPropagation()}>
            <div className="rule-expand-kv">
              <span className="rule-expand-k">匹配方式</span>
              <span className="rule-expand-v">{rule.matchType}</span>
            </div>
            <div className="rule-expand-kv">
              <span className="rule-expand-k">规则内容</span>
              <span className="rule-expand-v mono-block" title={rule.pattern}>{rule.pattern}</span>
            </div>
            <div className="rule-expand-kv">
              <span className="rule-expand-k">适用范围</span>
              <span className="rule-expand-v">{rule.scope}</span>
            </div>
            {rule.builtin && <div className="rule-expand-note">预设规则不可修改，仅可启停</div>}
          </div>
        )}
      </Row>
    )
  }

  return (
    <div className="security-rules-seg">
      <Section label={`预设安全规则（${presetRules.length} 条 · 启用 ${presetEnabled}）`}>
        {presetRules.map(renderRuleRow)}
      </Section>

      <Section
        label={`自定义规则（${customRules.length}）`}
        action={<button type="button" className="text-btn" onClick={openCreateModal}>+ 新建规则</button>}
      >
        {customRules.length === 0 && <div className="security-empty-inline">暂无自定义规则</div>}
        {customRules.map(renderRuleRow)}
      </Section>

      <p className="security-foot-hint">停用的规则不参与审查 · 审查在「审查记录」段执行 · 当前启用 {enabledCount} 条</p>

      {/* 新建/编辑规则弹窗 */}
      {modalOpen && (
        <FormModal
          title={editingId ? '编辑规则' : '新建规则'}
          confirmText={editingId ? '保存' : '创建'}
          confirmDisabled={confirmDisabled}
          onConfirm={handleConfirm}
          onClose={() => setModalOpen(false)}
        >
          <ModalField label="规则名">
            <input
              className="field-input"
              value={form.name}
              placeholder="如 禁止使用 eval"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </ModalField>
          {nameTaken && <p className="form-hint danger">规则名已存在，请换一个</p>}
          <ModalField label="严重级别">
            <select
              className="field-select"
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value as RuleSeverity })}
            >
              {RULE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </ModalField>
          <ModalField label="匹配方式">
            <select
              className="field-select"
              value={form.matchType}
              onChange={(e) => setForm({ ...form, matchType: e.target.value as RuleMatchType })}
            >
              {RULE_MATCH_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </ModalField>
          <ModalField label="规则内容">
            <input
              className="field-input"
              value={form.pattern}
              placeholder={form.matchType === '关键词' ? '如 eval(' : '如 new Function\\(.*\\)'}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            />
          </ModalField>
          {regexInvalid && <p className="form-hint danger">正则表达式不合法</p>}
          <ModalField label="适用范围">
            <select
              className="field-select"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
            >
              {RULE_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </ModalField>
          <ModalField label="规则说明">
            <input
              className="field-input"
              value={form.description}
              placeholder="命中时向审查人说明该规则的目的（选填）"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </ModalField>
        </FormModal>
      )}
    </div>
  )
}

/* ================= 段二：审查记录 ================= */

interface RecordsSegmentProps {
  records: ReviewRecord[]
  enabledCount: number
  /** 规则名映射（问题明细展示用） */
  ruleNameMap: Map<string, string>
  policy: SecurityData['policy']
  /** 保存定时审查（父组件单次更新 policy + 模拟执行记录），返回新记录 id（未生成则 null） */
  onSaveSchedule: (enabled: boolean, schedule: SecuritySchedule) => string | null
  /** 执行审查（父组件生成记录并置顶），返回新记录 id */
  onRun: (trigger?: ReviewRecord['trigger'], startedAt?: string) => string
  onHandleFinding: (recordId: string, findingId: string, status: RuleFinding['status']) => void
}

/** 定时审查弹窗表单 */
interface ScheduleForm {
  enabled: boolean
  freq: SecuritySchedule['freq']
  time: string
  weekday: number
  day: number
}

function RecordsSegment({
  records, enabledCount, ruleNameMap, policy, onSaveSchedule, onRun, onHandleFinding,
}: RecordsSegmentProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 定时审查弹窗
  const [schedOpen, setSchedOpen] = useState(false)
  const [schedForm, setSchedForm] = useState<ScheduleForm>({
    enabled: false, freq: '每天', time: '06:00', weekday: 1, day: 1,
  })

  // 卸载清理定时器
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const runDisabled = running || enabledCount === 0

  /** 立即审查：按钮禁用 1.2s 模拟执行 → 生成记录置顶并自动展开 */
  const handleRun = () => {
    if (runDisabled) return
    setRunning(true)
    timerRef.current = setTimeout(() => {
      const newId = onRun()
      setRunning(false)
      setExpandedId(newId)
    }, 1200)
  }

  /** 打开定时审查弹窗：预填当前配置 */
  const openScheduleModal = () => {
    setSchedForm({
      enabled: policy.scheduledReview,
      freq: policy.schedule.freq,
      time: policy.schedule.time,
      weekday: policy.schedule.weekday ?? 1,
      day: policy.schedule.day ?? 1,
    })
    setSchedOpen(true)
  }

  /** 弹窗底部实时预览文案 */
  const schedPreview = securityScheduleText({
    freq: schedForm.freq,
    time: schedForm.time,
    weekday: schedForm.weekday,
    day: schedForm.day,
  })

  /** 保存定时审查：更新配置；从关到开时模拟一次到点执行（生成「定时」记录并展开） */
  const handleSaveSchedule = () => {
    const next: SecuritySchedule = {
      freq: schedForm.freq,
      time: schedForm.time,
      ...(schedForm.freq === '每周' ? { weekday: schedForm.weekday } : {}),
      ...(schedForm.freq === '每月' ? { day: schedForm.day } : {}),
    }
    const newId = onSaveSchedule(schedForm.enabled, next)
    setSchedOpen(false)
    if (newId) setExpandedId(newId)
  }

  return (
    <div className="security-records-seg">
      {/* 工具行：定时审查入口 + 立即审查 */}
      <div className="records-toolbar">
        <button type="button" className="schedule-entry" onClick={openScheduleModal} title="设定定时审查规则">
          <span className="schedule-entry-name">定时审查</span>
          {policy.scheduledReview ? (
            <span className="schedule-entry-rule">{securityScheduleText(policy.schedule)}</span>
          ) : (
            <span className="schedule-entry-off">未开启</span>
          )}
          <span className="schedule-entry-set">设定</span>
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={runDisabled}
          title={enabledCount === 0 ? '请先启用至少一条规则' : undefined}
          onClick={handleRun}
        >
          {running ? '审查中…' : '立即审查'}
        </button>
      </div>

      {records.length === 0 ? (
        <div className="security-empty-state">
          <div className="security-empty-icon"><ShieldIcon size={40} /></div>
          <div className="security-empty-title">暂无审查记录</div>
          <div className="security-empty-desc">点击右上角立即审查，或设定定时审查到点自动执行</div>
        </div>
      ) : (
        <Section label={`审查记录（${records.length}）`}>
          {records.map((rec) => {
            const expanded = expandedId === rec.id
            const stats = findingStats(rec)
            return (
              <Row
                key={rec.id}
                className={`security-record-row${expanded ? ' open' : ''}`}
                onClick={() => setExpandedId(expanded ? null : rec.id)}
              >
                <span className="settings-row-main">
                  <span className="settings-row-text">
                    <span className="settings-row-title">
                      <span className="record-time">{rec.startedAt}</span>
                      <StatusBadge tone={triggerTone[rec.trigger]}>{rec.trigger}</StatusBadge>
                      <span className="record-scope">{rec.scope}</span>
                    </span>
                    <span className="settings-row-sub">{findingStatsText(rec)}</span>
                  </span>
                </span>
                <span className="settings-row-right">
                  {stats.total > 0
                    ? <StatusBadge tone="warning">{`${stats.total} 个问题`}</StatusBadge>
                    : <StatusBadge tone="success">无问题</StatusBadge>}
                  <span className={`rule-chevron${expanded ? ' open' : ''}`}>
                    <ChevronDownIcon size={13} />
                  </span>
                </span>

                {/* 展开区：执行摘要 + 问题明细 */}
                {expanded && (
                  <div className="record-expand" onClick={(e) => e.stopPropagation()}>
                    <div className="record-summary">
                      耗时 {rec.durationSec} 秒 · 扫描 {rec.scannedFiles} 个文件 · 应用规则 {rec.rulesApplied} 条
                    </div>
                    {rec.findings.length === 0 ? (
                      <div className="record-no-findings">本次审查未发现问题</div>
                    ) : (
                      rec.findings.map((f) => (
                        <div key={f.id} className="finding">
                          <div className="finding-head">
                            <StatusBadge tone={sevTone[f.severity]}>{f.severity}</StatusBadge>
                            <span className="finding-rule">{ruleNameMap.get(f.ruleId) ?? f.ruleId}</span>
                            <span className="finding-loc">{f.file}:{f.line}</span>
                          </div>
                          <div className="finding-desc">{f.description}</div>
                          <div className="finding-sug"><span className="finding-sug-label">建议：</span>{f.suggestion}</div>
                          <div className="mono-block" title={f.snippet}>{f.snippet}</div>
                          {f.status === '待处理' ? (
                            <div className="finding-actions">
                              <button
                                type="button"
                                className="btn-mini"
                                onClick={() => onHandleFinding(rec.id, f.id, '已修复')}
                              >
                                标记已修复
                              </button>
                              <button
                                type="button"
                                className="text-btn danger"
                                onClick={() => onHandleFinding(rec.id, f.id, '已忽略')}
                              >
                                忽略
                              </button>
                            </div>
                          ) : (
                            <div className="finding-handled">{f.status} · {f.handledAt}</div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Row>
            )
          })}
        </Section>
      )}

      {/* 定时审查设定弹窗 */}
      {schedOpen && (
        <FormModal
          title="定时审查"
          confirmText="保存"
          onConfirm={handleSaveSchedule}
          onClose={() => setSchedOpen(false)}
        >
          <ModalField label="启用定时审查">
            <div className="sched-enable-row">
              <Toggle checked={schedForm.enabled} onChange={(v) => setSchedForm({ ...schedForm, enabled: v })} />
              <span className="sched-enable-hint">{schedForm.enabled ? '到点后自动按启用规则执行审查' : '关闭后仅可手动立即审查'}</span>
            </div>
          </ModalField>
          <ModalField label="频率">
            <select
              className="field-select"
              value={schedForm.freq}
              onChange={(e) => setSchedForm({ ...schedForm, freq: e.target.value as SecuritySchedule['freq'] })}
            >
              {SCHEDULE_FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </ModalField>
          {schedForm.freq === '每周' && (
            <ModalField label="星期">
              <select
                className="field-select"
                value={schedForm.weekday}
                onChange={(e) => setSchedForm({ ...schedForm, weekday: Number(e.target.value) })}
              >
                {WEEKDAY_OPTIONS.map((w) => <option key={w} value={w}>{WEEKDAY_NAMES[w]}</option>)}
              </select>
            </ModalField>
          )}
          {schedForm.freq === '每月' && (
            <ModalField label="日期">
              <select
                className="field-select"
                value={schedForm.day}
                onChange={(e) => setSchedForm({ ...schedForm, day: Number(e.target.value) })}
              >
                {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} 日</option>)}
              </select>
            </ModalField>
          )}
          <ModalField label="时间">
            <div className="sched-time-row">
              <select
                className="field-select"
                value={schedForm.time.slice(0, 2)}
                onChange={(e) => setSchedForm({ ...schedForm, time: `${e.target.value}:${schedForm.time.slice(3)}` })}
              >
                {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="sched-time-colon">:</span>
              <select
                className="field-select"
                value={schedForm.time.slice(3)}
                onChange={(e) => setSchedForm({ ...schedForm, time: `${schedForm.time.slice(0, 2)}:${e.target.value}` })}
              >
                {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </ModalField>
          <div className="sched-preview">
            将于 <b>{schedPreview}</b> 自动执行安全审查
          </div>
        </FormModal>
      )}
    </div>
  )
}
