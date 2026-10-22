import { useState } from 'react'
import Dropdown from './Dropdown'
import { BranchIcon, FolderIcon } from './icons'
import './ContextSelector.css'

const PROJECTS = ['loomweb', 'loom-server', 'docs-site']
const BRANCHES = ['dev', 'main', 'feature/chat-ui']

/** 输入框下方的上下文选择器：项目 · 分支 */
export default function ContextSelector() {
  const [project, setProject] = useState(PROJECTS[0])
  const [branch, setBranch] = useState(BRANCHES[0])

  return (
    <div className="context-selector">
      <Dropdown options={PROJECTS} value={project} onChange={setProject}>
        <FolderIcon size={13} />
        <span>{project}</span>
      </Dropdown>
      <span className="context-dot">·</span>
      <Dropdown options={BRANCHES} value={branch} onChange={setBranch}>
        <BranchIcon size={13} />
        <span>{branch}</span>
      </Dropdown>
    </div>
  )
}
