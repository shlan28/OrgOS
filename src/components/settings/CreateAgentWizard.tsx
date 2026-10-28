import { useState } from 'react'
import type { RuntimeProfile } from '../../lib/runtimeApi'
import type { AdeAgent } from '../../data/projects'
import { ADE_MD_PLACEHOLDER } from '../../data/projects'
import StatusBadge from '../StatusBadge'
import './CreateAgentWizard.css'

interface CreateAgentWizardProps {
  runtimes: RuntimeProfile[]
  onClose: () => void
  onCreate: (agent: AdeAgent, runtimeId: string) => void
}

const STEPS = ['选择运行时', '命名', '选择模型', '个性化']

/**
 * 新建 Agent 四步向导：运行时 → 名称 → 模型（来自运行时配置）→ 个性化。
 * 只在最后一步创建，取消不会留下半成品。
 */
export default function CreateAgentWizard({ runtimes, onClose, onCreate }: CreateAgentWizardProps) {
  const [step, setStep] = useState(0)
  const [runtimeId, setRuntimeId] = useState(runtimes[0]?.id ?? '')
  const [name, setName] = useState('')
  const [model, setModel] = useState(runtimes[0]?.models[0] ?? '')
  const [role, setRole] = useState('研发工程师')
  const [adeMd, setAdeMd] = useState('')

  const runtime = runtimes.find((r) => r.id === runtimeId) ?? null
  const models = runtime?.models ?? []

  const canNext = [
    Boolean(runtime),
    Boolean(name.trim()),
    Boolean(model.trim()),
    true,
  ][step]

  const pickRuntime = (id: string) => {
    setRuntimeId(id)
    const next = runtimes.find((r) => r.id === id)
    setModel(next?.models[0] ?? '')
  }

  const handleCreate = () => {
    if (!runtime || !name.trim() || !model.trim()) return
    const agent: AdeAgent = {
      id: `ua${Date.now()}`,
      name: name.trim(),
      role: role.trim() || '研发工程师',
      model: model.trim(),
      status: '空闲',
      currentTask: '',
      linkedProject: '不关联项目',
      multimodalModel: '',
      collabModel: '',
      knowledgeBases: [],
      mcpServices: [],
      adeMd,
      tools: {},
      provider: runtime.provider,
      permission: 'workspace-write',
      workdir: '',
      runtimeId: runtime.id,
    }
    onCreate(agent, runtime.id)
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box agent-wizard" role="dialog" aria-modal="true" aria-label="新建 Agent">
        <div className="modal-head">
          <span className="modal-title">新建 Agent</span>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="wizard-steps">
          {STEPS.map((label, i) => (
            <span key={label} className={`wizard-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>
              <span className="wizard-step-num">{i < step ? '✓' : i + 1}</span>
              {label}
            </span>
          ))}
        </div>

        <div className="wizard-body">
          {step === 0 && (
            runtimes.length === 0 ? (
              <p className="wizard-hint">还没有可用的运行时，请先在「运行时」里新建一个。</p>
            ) : (
              <div className="wizard-runtime-list">
                {runtimes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`wizard-runtime${item.id === runtimeId ? ' active' : ''}`}
                    onClick={() => pickRuntime(item.id)}
                  >
                    <span className="wizard-runtime-name">{item.name}</span>
                    <span className="wizard-runtime-meta">
                      {item.provider} · {item.models.length} 个模型
                    </span>
                    <StatusBadge tone={item.hasKey ? 'success' : 'warning'}>
                      {item.hasKey ? '已配置 Key' : '未配置 Key'}
                    </StatusBadge>
                  </button>
                ))}
              </div>
            )
          )}

          {step === 1 && (
            <label className="wizard-field">
              <span>Agent 名称</span>
              <input
                className="field-input"
                value={name}
                autoFocus
                placeholder="如 研发工程师 ADE"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          {step === 2 && (
            models.length > 0 ? (
              <label className="wizard-field">
                <span>模型（来自运行时「{runtime?.name}」）</span>
                <select className="field-select" value={model} onChange={(e) => setModel(e.target.value)}>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            ) : (
              <label className="wizard-field">
                <span>模型（该运行时未配置模型列表，请手填）</span>
                <input className="field-input" value={model} placeholder="deepseek-chat" onChange={(e) => setModel(e.target.value)} />
              </label>
            )
          )}

          {step === 3 && (
            <div className="wizard-persona">
              <label className="wizard-field">
                <span>角色</span>
                <input className="field-input" value={role} onChange={(e) => setRole(e.target.value)} />
              </label>
              <label className="wizard-field">
                <span>ADE.md 个性化</span>
                <textarea
                  className="field-input wizard-md"
                  rows={9}
                  value={adeMd}
                  placeholder={ADE_MD_PLACEHOLDER}
                  onChange={(e) => setAdeMd(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="text-btn" onClick={onClose}>取消</button>
          <span className="wizard-actions-right">
            {step > 0 && (
              <button type="button" className="text-btn" onClick={() => setStep((s) => s - 1)}>上一步</button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                下一步
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={!canNext} onClick={handleCreate}>
                创建 Agent
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
