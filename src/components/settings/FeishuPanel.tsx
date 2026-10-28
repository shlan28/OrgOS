import { useEffect, useState } from 'react'
import { orgApi, type DocScopeLevel, type OrgFeishuConfig } from '../../lib/orgApi'
import { Section, Row } from '../SettingsRow'
import StatusBadge from '../StatusBadge'
import { FeishuIcon, GearIcon } from '../icons'
import './FeishuPanel.css'

interface PaneProps {
  feishu: OrgFeishuConfig
  onChanged: (next: OrgFeishuConfig) => void
  /** 非所有者只读 */
  canEdit?: boolean
}

const displayTime = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(/\//g, '-')
}

/** 企业授权面板（凭证 + 连接状态，数据来自后端） */
export function CorpAuthPane({ feishu, onChanged, canEdit = true }: PaneProps) {
  const [appIdDraft, setAppIdDraft] = useState(feishu.appId)
  const [secretDraft, setSecretDraft] = useState('')
  const [redirectDraft, setRedirectDraft] = useState(feishu.redirectUri)
  const [showSecret, setShowSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const dirty = appIdDraft !== feishu.appId
    || secretDraft.length > 0
    || redirectDraft !== feishu.redirectUri
  const connected = feishu.connected

  const appIdMask = (id: string) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '（未配置）')

  /** 保存凭证并立即校验（换取 tenant_access_token） */
  const handleSaveCred = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const saved = await orgApi.saveFeishu({
        appId: appIdDraft,
        appSecret: secretDraft,
        redirectUri: redirectDraft,
      })
      onChanged(saved)
      setSecretDraft('')
      try {
        const verified = await orgApi.verifyFeishu()
        onChanged(verified)
        setMessage('企业应用已连接')
      } catch (err) {
        setMessage(err instanceof Error ? err.message : '企业授权校验失败')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  /** 清除凭证（断开企业连接，不影响个人授权） */
  const handleClearCred = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      setAppIdDraft('')
      setSecretDraft('')
      const next = await orgApi.clearFeishu()
      onChanged(next)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="feishu-panel">
      <Section label="应用凭证">
        <div className="fs-field-row">
          <span className="fs-field-icon"><GearIcon size={15} /></span>
          <span className="fs-field-label">App ID</span>
          <input
            className="fs-field-input"
            value={appIdDraft}
            spellCheck={false}
            placeholder="cli_a3f8e09b2c61"
            disabled={!canEdit}
            onChange={(e) => setAppIdDraft(e.target.value)}
          />
        </div>
        <div className="fs-field-row">
          <span className="fs-field-icon"><GearIcon size={15} /></span>
          <span className="fs-field-label">App Secret</span>
          <span className="fs-field-input secret">
            <input
              type={showSecret ? 'text' : 'password'}
              value={secretDraft}
              spellCheck={false}
              placeholder={feishu.hasSecret ? '已保存，留空保持不变' : '应用密钥（仅本人可见）'}
              disabled={!canEdit}
              onChange={(e) => setSecretDraft(e.target.value)}
            />
            <button
              type="button"
              className="fs-eye-btn"
              title={showSecret ? '隐藏' : '显示'}
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? '隐藏' : '显示'}
            </button>
          </span>
        </div>
        <div className="fs-field-row">
          <span className="fs-field-icon"><GearIcon size={15} /></span>
          <span className="fs-field-label">重定向 URL</span>
          <input
            className="fs-field-input"
            value={redirectDraft}
            spellCheck={false}
            placeholder="https://<公网地址>/api/auth/feishu/callback"
            disabled={!canEdit}
            onChange={(e) => setRedirectDraft(e.target.value)}
          />
        </div>
        <Row className="fs-cred-actions-row">
          <span className="settings-row-sub">
            {dirty ? '有未保存的修改，保存后重新连接企业应用' : '企业应用凭证用于读取通讯录（tenant_access_token），导入成员需要'}
          </span>
          <span className="fs-cred-actions">
            <button
              type="button"
              className="text-btn"
              disabled={busy || !canEdit || (!appIdDraft && !feishu.hasSecret)}
              onClick={handleClearCred}
            >
              清除
            </button>
            <button type="button" className="btn-primary" disabled={!dirty || busy || !canEdit} onClick={handleSaveCred}>
              {busy ? '保存中…' : '保存'}
            </button>
          </span>
        </Row>
        {message && (
          <Row><span className="settings-row-sub">{message}</span></Row>
        )}
      </Section>

      <Section label="连接状态">
        <Row>
          <span className="settings-row-main">
            <span className="fs-row-icon"><FeishuIcon size={16} /></span>
            <span className="settings-row-text">
              <span className="settings-row-title">
                企业应用连接
                {connected
                  ? <StatusBadge tone="success">已连接</StatusBadge>
                  : <StatusBadge tone="neutral">未连接</StatusBadge>}
              </span>
              <span className="settings-row-sub">
                {connected
                  ? `可读取企业通讯录 · ${appIdMask(feishu.appId)}`
                  : feishu.hasSecret
                    ? '凭证已保存，但校验未通过；点上方「保存」重新校验'
                    : '配置并保存企业应用凭证后可导入成员'}
              </span>
            </span>
          </span>
        </Row>
      </Section>
    </div>
  )
}

/** 个人授权面板（状态来自后端；OAuth 流程仍为占位） */
export function UserAuthPane({ feishu, onChanged }: PaneProps) {
  const [authorizing, setAuthorizing] = useState(false)
  const [savingScope, setSavingScope] = useState(false)
  const [message, setMessage] = useState('')
  /** 服务端当前档位会申请的具体 scope 列表 */
  const [docScopes, setDocScopes] = useState<string[] | null>(null)

  useEffect(() => {
    orgApi.authorizeUrl()
      .then((r) => setDocScopes(r.docScopes ?? []))
      .catch(() => {})
  }, [feishu.docScopeLevel])

  const SCOPE_OPTIONS: { value: DocScopeLevel; label: string }[] = [
    { value: 'none', label: '仅身份' },
    { value: 'read', label: '只读' },
    { value: 'write', label: '可编辑 / 上传' },
    { value: 'all', label: '全部云文档' },
  ]

  /** 切换授权范围：写回后端并重置授权状态（需重新授权） */
  const handleScopeChange = async (level: DocScopeLevel) => {
    if (savingScope || level === feishu.docScopeLevel) return
    setSavingScope(true)
    setMessage('')
    try {
      const next = await orgApi.setFeishuDocScope(level)
      onChanged(next)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存授权范围失败')
    } finally {
      setSavingScope(false)
    }
  }

  const handleAuthorize = async () => {
    if (authorizing) return
    setAuthorizing(true)
    setMessage('')
    try {
      const res = await orgApi.authorizeUrl()
      if (!res.configured || !res.url) {
        setMessage('飞书个人授权尚未配置：请先完成企业授权并填写重定向 URL')
        return
      }
      window.location.href = res.url
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '无法打开飞书授权')
    } finally {
      setAuthorizing(false)
    }
  }

  const handleUnauthorize = async () => {
    setMessage('')
    try {
      const next = await orgApi.unauthorizeFeishu()
      onChanged(next)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '取消授权失败')
    }
  }

  return (
    <div className="feishu-panel">
      <Section label="个人授权">
        <Row>
          <span className="settings-row-main">
            <span className="fs-row-icon"><FeishuIcon size={16} /></span>
            <span className="settings-row-text">
              <span className="settings-row-title">
                飞书个人授权
                {feishu.authorized
                  ? <StatusBadge tone="success">已授权</StatusBadge>
                  : <StatusBadge tone="neutral">未授权</StatusBadge>}
              </span>
              <span className="settings-row-sub">
                {feishu.authorized
                  ? `${feishu.account || '当前账号'} · 授权于 ${displayTime(feishu.authorizedAt)} · 用于项目「文档」导入`
                  : '个人身份授权（user_access_token）用于项目「文档」导入，需包含文档 / 云空间 / Wiki 读取权限'}
              </span>
            </span>
          </span>
          <span className="settings-row-right">
            {feishu.authorized ? (
              <button type="button" className="text-btn" onClick={handleUnauthorize}>取消授权</button>
            ) : (
              <button
                type="button"
                className="text-btn fs-go-auth"
                disabled={authorizing}
                title="OAuth 登录飞书账号授权"
                onClick={handleAuthorize}
              >
                {authorizing ? '授权中…' : '去授权'}
              </button>
            )}
          </span>
        </Row>
        <Row>
          <span className="settings-row-main">
            <span className="settings-row-text">
              <span className="settings-row-title">授权范围</span>
              <span className="settings-row-sub">
                申请哪些云文档权限；修改后会重置授权，需要重新去授权
              </span>
            </span>
          </span>
          <span className="settings-row-right">
            <select
              className="field-select fs-scope-select"
              value={feishu.docScopeLevel ?? 'read'}
              disabled={savingScope}
              onChange={(e) => void handleScopeChange(e.target.value as DocScopeLevel)}
            >
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </span>
        </Row>
        {message && (
          <Row><span className="settings-row-sub">{message}</span></Row>
        )}
      </Section>
      <p className="fs-user-note">
        个人授权采用 OAuth（user_access_token）以你本人身份访问飞书，但仍由本应用发起；
        应用需先在飞书开放平台开通对应权限并发布版本，否则授权页会提示 20027「应用权限不足」。
        {docScopes === null
          ? '正在读取授权范围…'
          : docScopes.length === 0
            ? '当前仅申请身份权限；选择「只读 / 可编辑 / 全部」可申请云文档权限。'
            : `当前会申请 ${docScopes.length} 项云文档权限。`}
      </p>
    </div>
  )
}

/** 默认导出保留旧名（外部无引用，仅为语义兼容） */
export default CorpAuthPane
