import { useState } from 'react'
import type { AdeAgent } from '../../data/projects'
import {
  ADE_TOOLS,
  ADE_LLM_BASES,
  ADE_MULTIMODAL_MODELS,
  ADE_COLLAB_MODELS,
  ADE_KNOWLEDGE_BASES,
  ADE_MCP_SERVICES,
  ADE_LINKED_PROJECTS,
} from '../../data/projects'
import MultiSelect from '../MultiSelect'
import Toggle from '../Toggle'
import { RobotIcon } from '../icons'
import './AdeSettingsModal.css'

interface AdeSettingsModalProps {
  agent: AdeAgent
  /** 保存（确定） */
  onSave: (next: AdeAgent) => void
  /** 移除 */
  onRemove: (id: string) => void
  onClose: () => void
}

type ToolTab = 'all' | 'builtin' | 'im'

const TOOL_TABS: { key: ToolTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'builtin', label: '内置工具' },
  { key: 'im', label: 'IM渠道' },
]

/** ADE 配置弹窗：表单（名称/角色/关联项目/模型/知识库/MCP）+ 工具开关 + 移除 */
export default function AdeSettingsModal({ agent, onSave, onRemove, onClose }: AdeSettingsModalProps) {
  const [form, setForm] = useState({
    name: agent.name,
    role: agent.role,
    linkedProject: agent.linkedProject,
    model: agent.model,
    multimodalModel: agent.multimodalModel,
    collabModel: agent.collabModel,
    knowledgeBases: agent.knowledgeBases,
    mcpServices: agent.mcpServices,
  })
  const [tools, setTools] = useState<Record<string, boolean>>({ ...agent.tools })
  const [toolTab, setToolTab] = useState<ToolTab>('all')

  const enabledCount = ADE_TOOLS.filter((t) => tools[t.id]).length
  const visibleTools = toolTab === 'all'
    ? ADE_TOOLS
    : ADE_TOOLS.filter((t) => t.group === toolTab)
  const builtinTools = visibleTools.filter((t) => t.group === 'builtin')
  const imTools = visibleTools.filter((t) => t.group === 'im')

  const setTool = (id: string, on: boolean) => setTools((prev) => ({ ...prev, [id]: on }))
  const setAllTools = (on: boolean) =>
    setTools(Object.fromEntries(ADE_TOOLS.map((t) => [t.id, on])))

  const handleSave = () => {
    if (!form.name.trim()) return
    onSave({
      ...agent,
      name: form.name.trim(),
      role: form.role.trim() || agent.role,
      linkedProject: form.linkedProject,
      model: form.model,
      multimodalModel: form.multimodalModel,
      collabModel: form.collabModel,
      knowledgeBases: form.knowledgeBases,
      mcpServices: form.mcpServices,
      tools,
    })
  }

  const renderToolCard = (id: string) => {
    const tool = ADE_TOOLS.find((t) => t.id === id)!
    return (
      <div key={tool.id} className="ade-tool-card">
        <span className="ade-tool-badge" style={{ background: tool.color }}>{tool.badge}</span>
        <span className="ade-tool-info">
          <span className="ade-tool-name">{tool.name}</span>
          {tool.group === 'im' && !tool.credentialReady && (
            <span className="ade-tool-warn">
              尚未配置凭证
              <span className="ade-tool-link">去配置 ›</span>
            </span>
          )}
        </span>
        <Toggle checked={!!tools[tool.id]} onChange={(next) => setTool(tool.id, next)} />
      </div>
    )
  }

  return (
    <div
      className="ade-modal-overlay"
      onMouseDown={(e) => {
        // 点击遮罩关闭（仅当点击目标是遮罩本身）
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ade-modal" role="dialog" aria-modal="true" aria-label="ADE 配置">
        {/* 头部 */}
        <div className="ade-modal-head">
          <span className="ade-modal-title">
            <RobotIcon size={17} />
            {agent.name}
          </span>
          <button type="button" className="ade-modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        {/* 主体（可滚动） */}
        <div className="ade-modal-body">
          {/* 表单区：两列网格 */}
          <div className="ade-form-grid">
            <label className="ade-form-field">
              <span className="ade-form-label">ADE 名称<span className="ade-required">*</span></span>
              <input
                className="field-input"
                value={form.name}
                placeholder="如 研发工程师ADE"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="ade-form-field">
              <span className="ade-form-label">角色</span>
              <input
                className="field-input"
                value={form.role}
                placeholder="研发工程师/测试工程师…"
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              />
            </label>

            <label className="ade-form-field">
              <span className="ade-form-label">关联项目</span>
              <select
                className="field-select"
                value={form.linkedProject}
                onChange={(e) => setForm({ ...form, linkedProject: e.target.value })}
              >
                {ADE_LINKED_PROJECTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="ade-form-field">
              <span className="ade-form-label">大模型底座<span className="ade-required">*</span></span>
              <select
                className="field-select"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              >
                {ADE_LLM_BASES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <label className="ade-form-field">
              <span className="ade-form-label">多模态模型</span>
              <select
                className="field-select"
                value={form.multimodalModel}
                onChange={(e) => setForm({ ...form, multimodalModel: e.target.value })}
              >
                {ADE_MULTIMODAL_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="ade-form-field">
              <span className="ade-form-label">协作模型</span>
              <select
                className="field-select"
                value={form.collabModel}
                onChange={(e) => setForm({ ...form, collabModel: e.target.value })}
              >
                <option value="">请选择协作模型</option>
                {ADE_COLLAB_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <div className="ade-form-field">
              <span className="ade-form-label">个人知识库</span>
              <MultiSelect
                options={ADE_KNOWLEDGE_BASES}
                value={form.knowledgeBases}
                placeholder="请选择个人知识库"
                onChange={(knowledgeBases) => setForm({ ...form, knowledgeBases })}
              />
            </div>
            <div className="ade-form-field">
              <span className="ade-form-label">MCP 服务</span>
              <MultiSelect
                options={ADE_MCP_SERVICES}
                value={form.mcpServices}
                placeholder="请选择MCP服务"
                onChange={(mcpServices) => setForm({ ...form, mcpServices })}
              />
            </div>
          </div>

          {/* 工具开关区 */}
          <div className="ade-tools">
            <div className="ade-tools-head">
              <span className="ade-tools-title">工具开关</span>
              <span className="ade-tools-desc">
                关闭后，工具不可用，可<span className="ade-tools-hl">优化</span>上下文，<span className="ade-tools-hl">节省</span>Token用量
              </span>
            </div>

            <div className="ade-tools-bar">
              <div className="ade-tools-tabs">
                {TOOL_TABS.map((tab) => {
                  const count = tab.key === 'all'
                    ? ADE_TOOLS.length
                    : ADE_TOOLS.filter((t) => t.group === tab.key).length
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      className={`ade-tool-tab${toolTab === tab.key ? ' active' : ''}`}
                      onClick={() => setToolTab(tab.key)}
                    >
                      {tab.label} {count}
                    </button>
                  )
                })}
              </div>
              <div className="ade-tools-ops">
                <span className="ade-tools-count">已开启 {enabledCount} / {ADE_TOOLS.length}</span>
                <button type="button" className="ade-tools-link" onClick={() => setAllTools(true)}>全部开启</button>
                <button type="button" className="ade-tools-link muted" onClick={() => setAllTools(false)}>全部关闭</button>
              </div>
            </div>

            {builtinTools.length > 0 && (
              <>
                <div className="ade-tools-group-label">内置工具 {builtinTools.length} 项</div>
                <div className="ade-tool-grid">
                  {builtinTools.map((t) => renderToolCard(t.id))}
                </div>
              </>
            )}
            {imTools.length > 0 && (
              <>
                <div className="ade-tools-group-label">IM渠道 {imTools.length} 项</div>
                <div className="ade-tool-grid">
                  {imTools.map((t) => renderToolCard(t.id))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="ade-modal-foot">
          <button type="button" className="text-btn danger" onClick={() => onRemove(agent.id)}>移除</button>
          <span className="ade-modal-foot-right">
            <button type="button" className="text-btn" onClick={onClose}>取消</button>
            <button type="button" className="btn-primary" disabled={!form.name.trim()} onClick={handleSave}>确定</button>
          </span>
        </div>
      </div>
    </div>
  )
}
