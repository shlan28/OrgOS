import { useState } from 'react'
import type { UserSettings } from '../../data/settings'
import { allTools } from '../../data/settings'
import {
  ADE_TOOLS,
  ADE_LLM_BASES,
  ADE_MULTIMODAL_MODELS,
  ADE_COLLAB_MODELS,
  ADE_KNOWLEDGE_BASES,
  ADE_MCP_SERVICES,
  ADE_MD_PLACEHOLDER,
  CURRENT_USER,
  type AdeAgent,
} from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import MultiSelect from '../MultiSelect'
import Toggle from '../Toggle'
import StatusBadge from '../StatusBadge'
import AdeSettingsModal from '../project-detail/AdeSettingsModal'
import { RobotIcon } from '../icons'

interface AgentSettingsPanelProps {
  settings: UserSettings
  onUpdateSettings: (updater: (s: UserSettings) => UserSettings) => void
}

type ToolTab = 'all' | 'builtin' | 'im'

const TOOL_TABS: { key: ToolTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'builtin', label: '内置工具' },
  { key: 'im', label: 'IM渠道' },
]

/** 新建「我的 ADE」默认骨架 */
function createMyAde(): AdeAgent {
  const id = `ua${Date.now()}`
  return {
    id,
    name: '',
    role: '',
    model: ADE_LLM_BASES[0],
    status: '空闲',
    currentTask: '',
    linkedProject: '不关联项目',
    multimodalModel: ADE_MULTIMODAL_MODELS[0],
    collabModel: '',
    knowledgeBases: [],
    mcpServices: [],
    adeMd: '',
    tools: Object.fromEntries(ADE_TOOLS.map((t) => [t.id, false])),
  }
}

/**
 * Agent 设置面板：我的 ADE（复用 ADE 配置弹窗）+ 默认模型 + 默认工具 + 知识与上下文 + ADE.md。
 * 模型 / 工具 / 知识库 / MCP 为即改即存；ADE 弹窗与 ADE.md 为草稿 + 确认。
 */
export default function AgentSettingsPanel({ settings, onUpdateSettings }: AgentSettingsPanelProps) {
  /** ADE 配置弹窗编辑对象 id（null = 关闭） */
  const [adeEditingId, setAdeEditingId] = useState<string | null>(null)
  /** ADE 申请弹窗（新建） */
  const [adeApplying, setAdeApplying] = useState(false)
  const [adeForm, setAdeForm] = useState({ name: '', role: '' })
  /** 工具标签页过滤 */
  const [toolTab, setToolTab] = useState<ToolTab>('all')
  /** ADE.md 编辑态（null = 未编辑；字符串 = 草稿） */
  const [adeMdDraft, setAdeMdDraft] = useState<string | null>(null)

  const enabledCount = ADE_TOOLS.filter((t) => settings.tools[t.id]).length
  const visibleTools = toolTab === 'all' ? ADE_TOOLS : ADE_TOOLS.filter((t) => t.group === toolTab)
  const builtinTools = visibleTools.filter((t) => t.group === 'builtin')
  const imTools = visibleTools.filter((t) => t.group === 'im')

  const editingAde = settings.myAdes.find((a) => a.id === adeEditingId) ?? null

  /* —— 写操作 —— */

  const patch = (p: Partial<UserSettings>) => onUpdateSettings((s) => ({ ...s, ...p }))

  const setTool = (id: string, on: boolean) =>
    onUpdateSettings((s) => ({ ...s, tools: { ...s.tools, [id]: on } }))

  const setAllTools = (on: boolean) => patch({ tools: allTools(on) })

  /** 保存 ADE 配置弹窗（写回 myAdes） */
  const handleSaveAde = (next: AdeAgent) => {
    onUpdateSettings((s) => ({ ...s, myAdes: s.myAdes.map((a) => (a.id === next.id ? next : a)) }))
    setAdeEditingId(null)
  }

  /** 移除我的 ADE（若是默认项，默认切到剩余首项） */
  const handleRemoveAde = (id: string) => {
    onUpdateSettings((s) => {
      const myAdes = s.myAdes.filter((a) => a.id !== id)
      const defaultAdeId = s.defaultAdeId === id ? myAdes[0]?.id ?? '' : s.defaultAdeId
      return { ...s, myAdes, defaultAdeId }
    })
    setAdeEditingId(null)
  }

  /** 申请专属 ADE（新建写入列表并直接进入配置弹窗） */
  const handleApplyAde = () => {
    const name = adeForm.name.trim()
    if (!name) return
    const ade = { ...createMyAde(), name, role: adeForm.role.trim() || '研发工程师' }
    onUpdateSettings((s) => ({ ...s, myAdes: [...s.myAdes, ade] }))
    setAdeApplying(false)
    setAdeForm({ name: '', role: '' })
    setAdeEditingId(ade.id)
  }

  /* —— 渲染 —— */

  const renderToolCard = (id: string) => {
    const tool = ADE_TOOLS.find((t) => t.id === id)!
    return (
      <div key={tool.id} className="settings-tool-card">
        <span className="settings-tool-badge" style={{ background: tool.color }}>{tool.badge}</span>
        <span className="settings-tool-info">
          <span className="settings-tool-name">{tool.name}</span>
          {tool.group === 'im' && !tool.credentialReady && (
            <span className="settings-tool-warn">
              尚未配置凭证
              <span className="go-config">去配置 ›</span>
            </span>
          )}
        </span>
        <Toggle checked={!!settings.tools[tool.id]} onChange={(next) => setTool(tool.id, next)} />
      </div>
    )
  }

  const mdDraftValue = adeMdDraft ?? ''
  const mdDirty = adeMdDraft !== null && adeMdDraft !== settings.adeMd

  return (
    <div>
      {/* —— 我的 ADE —— */}
      <Section
        label={`我的 ADE（${settings.myAdes.length}）`}
        action={<button type="button" className="text-btn" onClick={() => setAdeApplying(true)}>＋ 申请专属 ADE</button>}
      >
        {settings.myAdes.length === 0 && (
          <Row><span className="settings-row-sub">暂无 ADE，请先申请专属 ADE</span></Row>
        )}
        {settings.myAdes.map((ade) => (
          <Row key={ade.id} onClick={() => setAdeEditingId(ade.id)} title="点击配置该 ADE">
            <div className="settings-row-main">
              <span className="ade-row-icon"><RobotIcon size={15} /></span>
              <span className="settings-row-text">
                <span className="settings-row-title">{ade.name}</span>
                <span className="settings-row-sub">
                  {ade.role || '未设置角色'} · {ade.model}{ade.currentTask ? ` · 当前：${ade.currentTask}` : ''}
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

      {/* —— 默认模型（即改即存） —— */}
      <Section label="默认模型">
        <div className="settings-field-row">
          <span className="field-label">大模型底座</span>
          <select className="field-select" value={settings.model} onChange={(e) => patch({ model: e.target.value })}>
            {ADE_LLM_BASES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="settings-field-row">
          <span className="field-label">多模态模型</span>
          <select className="field-select" value={settings.multimodalModel} onChange={(e) => patch({ multimodalModel: e.target.value })}>
            {ADE_MULTIMODAL_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="settings-field-row">
          <span className="field-label">协作模型</span>
          <select className="field-select" value={settings.collabModel} onChange={(e) => patch({ collabModel: e.target.value })}>
            <option value="">请选择协作模型</option>
            {ADE_COLLAB_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </Section>

      {/* —— 默认工具 —— */}
      <Section label="默认工具">
        <div className="settings-tools-head">
          <div className="settings-tools-title">工具开关</div>
          <div className="settings-tools-desc">
            关闭后，工具不可用，可<span className="hl">优化</span>上下文，<span className="hl">节省</span>Token用量
          </div>
          <div className="settings-tools-bar">
            <div className="settings-tools-tabs">
              {TOOL_TABS.map((tab) => {
                const count = tab.key === 'all'
                  ? ADE_TOOLS.length
                  : ADE_TOOLS.filter((t) => t.group === tab.key).length
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`settings-tool-tab${toolTab === tab.key ? ' active' : ''}`}
                    onClick={() => setToolTab(tab.key)}
                  >
                    {tab.label} {count}
                  </button>
                )
              })}
            </div>
            <div className="settings-tools-ops">
              <span>已开启 {enabledCount} / {ADE_TOOLS.length}</span>
              <button type="button" className="settings-tools-link" onClick={() => setAllTools(true)}>全部开启</button>
              <button type="button" className="settings-tools-link muted" onClick={() => setAllTools(false)}>全部关闭</button>
            </div>
          </div>
        </div>
        {builtinTools.length > 0 && (
          <>
            <div className="settings-tools-group-label">内置工具 {builtinTools.length} 项</div>
            <div className="settings-tool-grid">{builtinTools.map((t) => renderToolCard(t.id))}</div>
          </>
        )}
        {imTools.length > 0 && (
          <>
            <div className="settings-tools-group-label">IM渠道 {imTools.length} 项</div>
            <div className="settings-tool-grid">{imTools.map((t) => renderToolCard(t.id))}</div>
          </>
        )}
      </Section>

      {/* —— 知识与上下文（即改即存） —— */}
      <Section label="知识与上下文">
        <div className="settings-field-row">
          <span className="field-label">个人知识库</span>
          <MultiSelect
            options={ADE_KNOWLEDGE_BASES}
            value={settings.knowledgeBases}
            placeholder="请选择个人知识库"
            onChange={(knowledgeBases) => patch({ knowledgeBases })}
          />
        </div>
        <div className="settings-field-row">
          <span className="field-label">MCP 服务</span>
          <MultiSelect
            options={ADE_MCP_SERVICES}
            value={settings.mcpServices}
            placeholder="请选择MCP服务"
            onChange={(mcpServices) => patch({ mcpServices })}
          />
        </div>
      </Section>

      {/* —— ADE.md 个性化（草稿 + 保存） —— */}
      <Section
        label="ADE.md 个性化"
        action={
          adeMdDraft === null ? (
            <button type="button" className="text-btn" onClick={() => setAdeMdDraft(settings.adeMd)}>编辑</button>
          ) : undefined
        }
      >
        <Row>
          <div className="settings-row-text">
            <span className="settings-row-title">ADE.md 内容</span>
            <span className="settings-row-sub">定义 Agent 的身份、能力与说话方式（会写入系统提示词）</span>
          </div>
          <div className="settings-row-right">
            {settings.adeMd ? `共 ${settings.adeMd.split('\n').length} 行` : '未配置'}
          </div>
        </Row>
        {adeMdDraft !== null && (
          <div className="settings-ade-md">
            <div className="settings-ade-md-toolbar">
              <span className="settings-ade-md-unsaved">{mdDirty ? '有未保存的修改' : ' '}</span>
            </div>
            <textarea
              className="settings-ade-md-textarea"
              placeholder={ADE_MD_PLACEHOLDER}
              value={mdDraftValue}
              onChange={(e) => setAdeMdDraft(e.target.value)}
            />
            <div className="settings-ade-md-actions">
              <button type="button" className="text-btn" onClick={() => setAdeMdDraft(null)}>取消</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!mdDirty || !mdDraftValue.trim()}
                onClick={() => {
                  patch({ adeMd: mdDraftValue })
                  setAdeMdDraft(null)
                }}
              >
                保存
              </button>
            </div>
          </div>
        )}
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

      {/* 申请专属 ADE 弹窗（居中 FormModal） */}
      {adeApplying && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAdeApplying(false)
          }}
        >
          <div className="modal-box" role="dialog" aria-modal="true" aria-label="申请专属 ADE">
            <div className="modal-head">
              <span className="modal-title">申请专属 ADE</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setAdeApplying(false)}>×</button>
            </div>
            <div className="modal-fields">
              <div className="modal-field">
                <div className="modal-field-label">名称<span className="ade-required">*</span></div>
                <input
                  className="field-input"
                  placeholder="如 研发工程师ADE"
                  value={adeForm.name}
                  autoFocus
                  onChange={(e) => setAdeForm({ ...adeForm, name: e.target.value })}
                />
              </div>
              <div className="modal-field">
                <div className="modal-field-label">角色</div>
                <input
                  className="field-input"
                  placeholder="研发工程师/测试工程师…"
                  value={adeForm.role}
                  onChange={(e) => setAdeForm({ ...adeForm, role: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-btn" onClick={() => setAdeApplying(false)}>取消</button>
              <button type="button" className="btn-primary" disabled={!adeForm.name.trim()} onClick={handleApplyAde}>
                创建并配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 当前用户徽标（占位，供视觉对齐校验） */}
      <p className="settings-current-user">
        当前用户：{CURRENT_USER.name} · 默认 ADE：{settings.myAdes.find((a) => a.id === settings.defaultAdeId)?.name ?? '未设置'}
      </p>
    </div>
  )
}
