import { useEffect, useState } from 'react'
import type { AdeAgent } from '../../data/projects'
import {
  ADE_MODEL_OPTIONS,
  ADE_KNOWLEDGE_BASES,
  ADE_MCP_SERVICES,
  ADE_MD_PLACEHOLDER,
} from '../../data/projects'
import { runtimeApi } from '../../lib/runtimeApi'
import MultiSelect from '../MultiSelect'
import { RobotIcon } from '../icons'
import './AdeSettingsModal.css'
import './AdeDetailModal.css'

interface AdeSettingsModalProps {
  agent: AdeAgent
  onSave: (next: AdeAgent) => void
  onRemove: (id: string) => void
  onClose: () => void
}

type SectionKey = 'name' | 'models' | 'context' | 'ademd'

const NAV_ITEMS: { key: SectionKey; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'models', label: '模型' },
  { key: 'context', label: '知识与上下文' },
  { key: 'ademd', label: 'ADE.md' },
]

/**
 * Agent 详情弹窗：左侧可点击目录 + 右侧编辑区。
 * 目录：名称 / 模型 1-4 / 知识与上下文 / ADE.md。
 */
export default function AdeSettingsModal({ agent, onSave, onRemove, onClose }: AdeSettingsModalProps) {
  const [section, setSection] = useState<SectionKey>('name')
  const [form, setForm] = useState({
    name: agent.name,
    model1: agent.model,
    model2: agent.multimodalModel,
    model3: agent.collabModel,
    model4: agent.model4 ?? '',
    knowledgeBases: agent.knowledgeBases,
    mcpServices: agent.mcpServices,
    adeMd: agent.adeMd,
  })
  /** 模型候选：优先取绑定运行时的模型列表 */
  const [modelOptions, setModelOptions] = useState<string[]>(ADE_MODEL_OPTIONS)

  useEffect(() => {
    let alive = true
    runtimeApi.runtimes()
      .then(({ runtimes }) => {
        if (!alive) return
        const runtime = runtimes.find((r) => r.id === agent.runtimeId)
        if (runtime && runtime.models.length > 0) setModelOptions(runtime.models)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [agent.runtimeId])

  const handleSave = () => {
    if (!form.name.trim()) return
    onSave({
      ...agent,
      name: form.name.trim(),
      model: form.model1,
      multimodalModel: form.model2,
      collabModel: form.model3,
      model4: form.model4,
      knowledgeBases: form.knowledgeBases,
      mcpServices: form.mcpServices,
      adeMd: form.adeMd,
    })
  }

  const renderModelSelect = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="ade-detail-field">
      <span className="ade-detail-field-label">{label}</span>
      <select className="field-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">未选择</option>
        {Array.from(new Set([value, ...modelOptions])).filter(Boolean).map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </label>
  )

  return (
    <div
      className="ade-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ade-modal ade-detail-modal" role="dialog" aria-modal="true" aria-label="Agent 详情">
        <div className="ade-modal-head">
          <span className="ade-modal-title">
            <RobotIcon size={17} />
            {agent.name}
          </span>
          <button type="button" className="ade-modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="ade-detail">
          <nav className="ade-detail-nav" aria-label="Agent 配置目录">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`ade-detail-nav-item${section === item.key ? ' active' : ''}`}
                onClick={() => setSection(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ade-detail-panel">
            {section === 'name' && (
              <label className="ade-detail-field">
                <span className="ade-detail-field-label">Agent 名称</span>
                <input
                  className="field-input"
                  value={form.name}
                  placeholder="如 研发工程师ADE"
                  autoFocus
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
            )}

            {section === 'models' && (
              <div className="ade-detail-stack">
                {renderModelSelect('模型 1', form.model1, (v) => setForm({ ...form, model1: v }))}
                {renderModelSelect('模型 2', form.model2, (v) => setForm({ ...form, model2: v }))}
                {renderModelSelect('模型 3', form.model3, (v) => setForm({ ...form, model3: v }))}
                {renderModelSelect('模型 4', form.model4, (v) => setForm({ ...form, model4: v }))}
              </div>
            )}

            {section === 'context' && (
              <div className="ade-detail-stack">
                <label className="ade-detail-field">
                  <span className="ade-detail-field-label">个人知识库</span>
                  <MultiSelect
                    options={ADE_KNOWLEDGE_BASES}
                    value={form.knowledgeBases}
                    placeholder="请选择个人知识库"
                    onChange={(knowledgeBases) => setForm({ ...form, knowledgeBases })}
                  />
                </label>
                <label className="ade-detail-field">
                  <span className="ade-detail-field-label">MCP 服务</span>
                  <MultiSelect
                    options={ADE_MCP_SERVICES}
                    value={form.mcpServices}
                    placeholder="请选择MCP服务"
                    onChange={(mcpServices) => setForm({ ...form, mcpServices })}
                  />
                </label>
              </div>
            )}

            {section === 'ademd' && (
              <label className="ade-detail-field fill">
                <span className="ade-detail-field-label">ADE.md 个性化</span>
                <textarea
                  className="field-input ade-detail-md"
                  value={form.adeMd}
                  placeholder={ADE_MD_PLACEHOLDER}
                  onChange={(e) => setForm({ ...form, adeMd: e.target.value })}
                />
              </label>
            )}
          </div>
        </div>

        <div className="ade-modal-foot">
          <button type="button" className="text-btn danger" onClick={() => onRemove(agent.id)}>移除</button>
          <span className="ade-modal-foot-right">
            <button type="button" className="text-btn" onClick={onClose}>取消</button>
            <button type="button" className="btn-primary" disabled={!form.name.trim()} onClick={handleSave}>
              保存
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
