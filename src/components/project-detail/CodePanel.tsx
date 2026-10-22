import { useState } from 'react'
import type { CodeRepo } from '../../data/projects'
import { CODE_REPO_CATALOG } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import StatusBadge from '../StatusBadge'
import SegmentedControl from '../SegmentedControl'
import { FolderIcon, BranchIcon } from '../icons'
import './CodePanel.css'

interface CodePanelProps {
  repos: CodeRepo[]
  onUpdateRepos: (repos: CodeRepo[]) => void
}

type SegKey = 'editable' | 'readonly'

/** 分段说明文案：随段切换，表达「可写 / 仅上下文」语义差异 */
const SEG_HINT: Record<SegKey, string> = {
  editable: 'ADE 可读取并提交代码的仓库',
  readonly: '仅作为上下文提供给 Agent，ADE 不可写入',
}

/** 添加弹窗说明字段占位文案 */
const NOTE_PLACEHOLDER: Record<SegKey, string> = {
  editable: '如 项目主仓，业务代码开发',
  readonly: '给 Agent 提供什么上下文，如 组件库源码，提供组件 API 上下文',
}

/** 仓库类型展示文案 */
const TYPE_LABEL: Record<CodeRepo['type'], string> = {
  gitlab: 'GitLab',
  svn: 'SVN',
}

const nowStamp = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 代码面板：分段切换「可编辑仓库 / 只读仓库」
 * 可编辑 = ADE 可读写提交；只读 = 仅给 Agent 提供上下文
 * 仓库添加后不可编辑，只能移除
 */
export default function CodePanel({ repos, onUpdateRepos }: CodePanelProps) {
  const [segment, setSegment] = useState<SegKey>('editable')
  // 添加弹窗
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ name: string; type: CodeRepo['type']; branch: string; note: string }>({
    name: '', type: 'gitlab', branch: '', note: '',
  })

  const segRepos = repos.filter((r) => r.mode === segment)
  const nameTaken = segRepos.some((r) => r.name === form.name.trim())
  const addDisabled = !form.name.trim() || !form.branch.trim() || nameTaken

  /** 当前类型下的可选仓库目录 */
  const typeRepos = CODE_REPO_CATALOG.filter((c) => c.type === form.type)
  /** 所选仓库的分支列表 */
  const branches = typeRepos.find((c) => c.name === form.name)?.branches ?? []

  /** 重置表单：预选当前类型第一个未添加的仓库及其首个分支 */
  const resetForm = () => {
    const taken = new Set(repos.filter((r) => r.mode === segment).map((r) => r.name))
    const first = CODE_REPO_CATALOG.find((c) => c.type === 'gitlab' && !taken.has(c.name))
      ?? CODE_REPO_CATALOG.find((c) => c.type === 'gitlab')
    setForm({ name: '', type: 'gitlab', branch: '', note: '' })
    if (first) {
      setForm({ name: first.name, type: 'gitlab', branch: first.branches[0] ?? '', note: '' })
    }
  }

  /** 切换仓库类型：重置仓库名与分支，并预选该类型第一个未添加的仓库 */
  const handleTypeChange = (type: CodeRepo['type']) => {
    const taken = new Set(repos.filter((r) => r.mode === segment).map((r) => r.name))
    const first = CODE_REPO_CATALOG.find((c) => c.type === type && !taken.has(c.name))
      ?? CODE_REPO_CATALOG.find((c) => c.type === type)
    setForm({ ...form, type, name: first?.name ?? '', branch: first?.branches[0] ?? '' })
  }

  /** 打开弹窗：重置并预选 */
  const openAddModal = () => {
    resetForm()
    setAdding(true)
  }

  /** 切换仓库：分支重置为该仓库首个分支 */
  const handleRepoChange = (name: string) => {
    const repo = typeRepos.find((c) => c.name === name)
    setForm({ ...form, name, branch: repo?.branches[0] ?? '' })
  }

  const handleAdd = () => {
    if (addDisabled) return
    const repo: CodeRepo = {
      id: `r${Date.now()}`,
      name: form.name.trim(),
      type: form.type,
      branch: form.branch.trim(),
      mode: segment,
      note: form.note.trim(),
      syncedAt: nowStamp(),
    }
    onUpdateRepos([...repos, repo])
    setAdding(false)
    resetForm()
  }

  const handleRemove = (id: string) => {
    onUpdateRepos(repos.filter((r) => r.id !== id))
  }

  return (
    <div className="code-panel">
      <SegmentedControl
        value={segment}
        onChange={(k) => setSegment(k as SegKey)}
        items={[
          { key: 'editable', label: `可编辑仓库（${repos.filter((r) => r.mode === 'editable').length}）`, icon: null },
          { key: 'readonly', label: `只读仓库（${repos.filter((r) => r.mode === 'readonly').length}）`, icon: null },
        ]}
      />
      <p className="code-seg-hint">{SEG_HINT[segment]}</p>

      <Section
        label={segment === 'editable' ? '可编辑仓库' : '只读仓库'}
        action={<button type="button" className="text-btn" onClick={openAddModal}>+ 添加</button>}
      >
        {segRepos.length === 0 && <div className="code-empty">暂无仓库</div>}
        {segRepos.map((repo) => (
          <Row key={repo.id} className="code-repo-row">
            <span className="settings-row-main">
              <FolderIcon size={16} className="code-repo-icon" />
              <span className="settings-row-text">
                <span className="settings-row-title">{repo.name}</span>
                <span className="settings-row-sub">
                  {repo.note || TYPE_LABEL[repo.type]}
                </span>
              </span>
            </span>
            <span className="settings-row-right">
              {segment === 'readonly' && <StatusBadge tone="neutral">只读</StatusBadge>}
              <span className={`code-type-badge ${repo.type}`}>{TYPE_LABEL[repo.type]}</span>
              <span className="code-branch" title="默认分支">
                <BranchIcon size={12} />
                {repo.branch}
              </span>
              <span className="code-synced">同步于 {repo.syncedAt}</span>
              <button
                type="button"
                className="text-btn danger"
                onClick={() => handleRemove(repo.id)}
              >
                移除
              </button>
            </span>
          </Row>
        ))}
      </Section>

      {adding && (
        <FormModal
          title={segment === 'editable' ? '添加可编辑仓库' : '添加只读仓库'}
          confirmText="添加"
          confirmDisabled={addDisabled}
          onConfirm={handleAdd}
          onClose={() => { setAdding(false); resetForm() }}
        >
          <ModalField label="仓库类型">
            <select
              className="field-select"
              value={form.type}
              onChange={(e) => handleTypeChange(e.target.value as CodeRepo['type'])}
            >
              <option value="gitlab">GitLab</option>
              <option value="svn">SVN</option>
            </select>
          </ModalField>
          <ModalField label="仓库名">
            <select
              className="field-select"
              value={form.name}
              onChange={(e) => handleRepoChange(e.target.value)}
            >
              <option value="" disabled>请选择仓库</option>
              {typeRepos.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </ModalField>
          {nameTaken && <p className="form-hint danger">该段已存在同名仓库</p>}
          <ModalField label="默认分支">
            <select
              className="field-select"
              value={form.branch}
              onChange={(e) => setForm({ ...form, branch: e.target.value })}
              disabled={!form.name}
            >
              <option value="" disabled>请选择分支</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </ModalField>
          <ModalField label={segment === 'editable' ? '用途说明' : '上下文说明'}>
            <input className="field-input" value={form.note} placeholder={NOTE_PLACEHOLDER[segment]} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </ModalField>
        </FormModal>
      )}
    </div>
  )
}
