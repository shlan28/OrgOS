import { useState } from 'react'
import type { RuntimeInfo, RuntimeProfile } from '../../lib/runtimeApi'
import { runtimeApi } from '../../lib/runtimeApi'
import { Section, Row } from '../SettingsRow'
import StatusBadge from '../StatusBadge'
import FormModal, { ModalField } from '../FormModal'
import { RobotIcon } from '../icons'
import './RuntimeManager.css'

interface RuntimeManagerProps {
  runtime: RuntimeInfo | null
  runtimes: RuntimeProfile[]
  onChanged: () => void
  onRefreshRuntime: () => void
}

interface RuntimeForm {
  name: string
  provider: string
  baseUrl: string
  modelsText: string
  apiKey: string
}

const PROVIDERS = ['deepseek-official', 'openai-compatible']
const DEFAULT_MODELS = 'deepseek-chat\ndeepseek-reasoner\ndeepseek-flash'

/** 运行时列表与编辑器：一个运行时 = 模型服务（provider/base URL/模型列表/Key） */
export default function RuntimeManager({ runtime, runtimes, onChanged, onRefreshRuntime }: RuntimeManagerProps) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<RuntimeForm>({ name: '', provider: PROVIDERS[0], baseUrl: '', modelsText: '', apiKey: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchNote, setFetchNote] = useState('')
  const [fetchError, setFetchError] = useState('')

  const openNew = () => {
    setForm({ name: '', provider: PROVIDERS[0], baseUrl: '', modelsText: DEFAULT_MODELS, apiKey: '' })
    setError('')
    setEditingId('new')
  }

  const openEdit = (profile: RuntimeProfile) => {
    setForm({
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      modelsText: profile.models.join('\n'),
      apiKey: '',
    })
    setError('')
    setEditingId(profile.id)
  }

  const close = () => { setEditingId(null); setError('') }

  /** 从 provider 的 /models 拉取模型，填充到编辑框（仍可手动修改） */
  const pullModels = async () => {
    if (fetching) return
    setFetching(true)
    setFetchNote('')
    setFetchError('')
    try {
      const { models } = await runtimeApi.fetchModels({
        provider: form.provider,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        runtimeId: editingId && editingId !== 'new' ? editingId : undefined,
      })
      setForm((f) => ({ ...f, modelsText: models.join('\n') }))
      setFetchNote(`已拉取 ${models.length} 个模型`)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '拉取失败')
    } finally {
      setFetching(false)
    }
  }

  const save = async () => {
    if (!form.name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const models = form.modelsText
        .split(/[\n,]/)
        .map((m) => m.trim())
        .filter(Boolean)
      const payload = {
        name: form.name.trim(),
        provider: form.provider,
        baseUrl: form.baseUrl.trim(),
        models,
      }
      const { runtime: saved } = editingId === 'new'
        ? await runtimeApi.createRuntime(payload)
        : await runtimeApi.updateRuntime(editingId as string, payload)
      if (form.apiKey.trim()) await runtimeApi.setRuntimeKey(saved.id, form.apiKey.trim())
      close()
      onChanged()
      onRefreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (profile: RuntimeProfile) => {
    if (!window.confirm(`删除运行时「${profile.name}」？使用它的 Agent 会变为未绑定。`)) return
    try {
      await runtimeApi.deleteRuntime(profile.id)
      onChanged()
      onRefreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const editing = editingId === 'new' ? null : runtimes.find((r) => r.id === editingId) ?? null

  return (
    <>
      <Section label="运行环境">
        <Row>
          <div className="settings-row-main">
            <span className="ade-row-icon"><RobotIcon size={15} /></span>
            <span className="settings-row-text">
              <span className="settings-row-title">
                DeepSeek Harness CLI
                <StatusBadge tone={runtime?.cli.exists ? 'success' : 'danger'}>
                  {runtime?.cli.exists ? '已就绪' : '未找到'}
                </StatusBadge>
              </span>
              <span className="settings-row-sub">
                {runtime ? `${runtime.cli.version ?? '版本未知'} · ${runtime.cli.path}` : '正在检测…'}
              </span>
            </span>
          </div>
          <div className="settings-row-right">
            <button type="button" className="text-btn" onClick={onRefreshRuntime}>刷新</button>
          </div>
        </Row>
      </Section>

      <Section
        label="运行时"
        action={<button type="button" className="text-btn" onClick={openNew}>＋ 新建运行时</button>}
      >
        {runtimes.length === 0 && (
          <Row><span className="settings-row-sub">还没有运行时，先新建一个模型服务</span></Row>
        )}

        {runtimes.map((profile) => (
          <Row key={profile.id} onClick={() => openEdit(profile)} title="点击编辑运行时">
            <div className="settings-row-main">
              <span className="ade-row-icon"><RobotIcon size={15} /></span>
              <span className="settings-row-text">
                <span className="settings-row-title">
                  {profile.name}
                  <StatusBadge tone={profile.hasKey ? 'success' : 'warning'}>
                    {profile.hasKey ? '已配置 Key' : '未配置 Key'}
                  </StatusBadge>
                </span>
                <span className="settings-row-sub">
                  {profile.provider}
                  {profile.baseUrl ? ` · ${profile.baseUrl}` : ''}
                  {' · '}{profile.models.length} 个模型
                </span>
              </span>
            </div>
            <div className="settings-row-right">
              <button
                type="button"
                className="text-btn"
                onClick={(e) => { e.stopPropagation(); remove(profile) }}
              >
                删除
              </button>
            </div>
          </Row>
        ))}
      </Section>

      {editingId !== null && (
        <FormModal
          title={editingId === 'new' ? '新建运行时' : '编辑运行时'}
          confirmText={busy ? '保存中…' : '保存'}
          confirmDisabled={!form.name.trim() || busy}
          onConfirm={save}
          onClose={close}
          wide
        >
          <ModalField label="名称">
            <input
              className="field-input"
              value={form.name}
              autoFocus
              placeholder="如 DeepSeek 官方"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </ModalField>
          <ModalField label="Provider">
            <select
              className="field-select"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              {Array.from(new Set([form.provider, ...PROVIDERS])).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Base URL（可选）">
            <input
              className="field-input"
              value={form.baseUrl}
              placeholder="留空使用官方地址"
              spellCheck={false}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </ModalField>
          <ModalField label="模型列表（每行一个）">
            <div className="runtime-models-actions">
              <span className="runtime-models-hint">
                {fetchNote || '可从 provider 的 /models 拉取，也可手动编辑'}
              </span>
              <button type="button" className="text-btn" disabled={fetching} onClick={pullModels}>
                {fetching ? '拉取中…' : '拉取模型'}
              </button>
            </div>
            <textarea
              className="field-input"
              rows={4}
              value={form.modelsText}
              spellCheck={false}
              placeholder={DEFAULT_MODELS}
              onChange={(e) => setForm({ ...form, modelsText: e.target.value })}
            />
            {fetchError && <p className="form-hint danger">{fetchError}</p>}
          </ModalField>
          <ModalField label="API Key">
            <input
              className="field-input"
              type="password"
              value={form.apiKey}
              spellCheck={false}
              autoComplete="off"
              placeholder={editing?.hasKey ? '已配置，留空保持不变' : 'sk-...'}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </ModalField>
          {error && <p className="form-hint danger">{error}</p>}
        </FormModal>
      )}
    </>
  )
}
