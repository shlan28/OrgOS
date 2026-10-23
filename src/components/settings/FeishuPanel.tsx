import { useState } from 'react'
import type { UserSettings } from '../../data/settings'
import { feishuCorpConnected } from '../../data/settings'
import { Section, Row } from '../SettingsRow'
import StatusBadge from '../StatusBadge'
import { FeishuIcon, GearIcon } from '../icons'
import './FeishuPanel.css'

interface FeishuPanelProps {
  settings: UserSettings
  onUpdateSettings: (updater: (s: UserSettings) => UserSettings) => void
}

/**
 * 「成员管理」面板 · 顶部子 tab 一：企业授权（tenant_access_token，读取企业通讯录）。
 * 凭证表单（保存 = 已连接）+ 连接状态行；换凭证保存自动重连，不影响个人授权。
 * 同时导出给「个人授权」tab 用的 UserAuthPane（纯 OAuth，无凭证）。
 */

/** 企业授权面板（凭证 + 连接状态） */
export function CorpAuthPane({ settings, onUpdateSettings }: FeishuPanelProps) {
  const { feishu } = settings
  const [appIdDraft, setAppIdDraft] = useState(feishu.appId)
  const [secretDraft, setSecretDraft] = useState(feishu.appSecret)
  const [showSecret, setShowSecret] = useState(false)

  const dirty = appIdDraft !== feishu.appId || secretDraft !== feishu.appSecret
  const connected = feishuCorpConnected(feishu)

  /** 保存凭证（企业身份与个人授权解耦：换凭证不清空个人授权） */
  const handleSaveCred = () => {
    onUpdateSettings((s) => ({
      ...s,
      feishu: { ...s.feishu, appId: appIdDraft.trim(), appSecret: secretDraft.trim() },
    }))
  }

  /** 清除凭证（断开企业连接，同样不影响个人授权） */
  const handleClearCred = () => {
    setAppIdDraft('')
    setSecretDraft('')
    onUpdateSettings((s) => ({ ...s, feishu: { ...s.feishu, appId: '', appSecret: '' } }))
  }

  const appIdMask = (id: string) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '（未配置）')

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
              placeholder="应用密钥（仅本人可见）"
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
        <Row className="fs-cred-actions-row">
          <span className="settings-row-sub">
            {dirty ? '有未保存的修改，保存后重新连接企业应用' : '企业应用凭证用于读取通讯录（tenant_access_token），导入成员需要'}
          </span>
          <span className="fs-cred-actions">
            <button
              type="button"
              className="text-btn"
              disabled={!appIdDraft && !secretDraft}
              onClick={handleClearCred}
            >
              清除
            </button>
            <button type="button" className="btn-primary" disabled={!dirty} onClick={handleSaveCred}>保存</button>
          </span>
        </Row>
      </Section>

      {/* 连接状态行：保存即连接（Mock 不失败） */}
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
                  : '配置并保存企业应用凭证后可导入成员'}
              </span>
            </span>
          </span>
        </Row>
      </Section>
    </div>
  )
}

/** 个人授权面板（纯 OAuth：user_access_token，无需应用凭证） */
export function UserAuthPane({ settings, onUpdateSettings }: FeishuPanelProps) {
  const { feishu } = settings
  const [authorizing, setAuthorizing] = useState(false)

  /** 发起个人授权（OAuth Mock：800ms 授权中 → 已授权） */
  const handleAuthorize = () => {
    setAuthorizing(true)
    window.setTimeout(() => {
      onUpdateSettings((s) => ({
        ...s,
        feishu: {
          ...s.feishu,
          authorized: true,
          authorizedAt: new Date().toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          }).replace(/\//g, '-'),
        },
      }))
      setAuthorizing(false)
    }, 800)
  }

  /** 取消授权 */
  const handleUnauthorize = () => {
    onUpdateSettings((s) => ({
      ...s,
      feishu: { ...s.feishu, authorized: false, authorizedAt: '' },
    }))
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
                  ? `${feishu.authorizedAccount} · 授权于 ${feishu.authorizedAt} · 用于项目「文档」导入`
                  : '个人身份授权（user_access_token）用于项目「文档」导入，无需配置应用凭证'}
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
      </Section>
      <p className="fs-user-note">
        个人授权采用 OAuth 登录飞书账号授权，无需配置应用凭证；与「企业授权」互不影响。
      </p>
    </div>
  )
}

/** 默认导出保留旧名（外部无引用，仅为语义兼容） */
export default CorpAuthPane
