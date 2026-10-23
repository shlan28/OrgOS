import { useState } from 'react'
import type { UserSettings } from '../../data/settings'
import { Section, Row } from '../SettingsRow'
import StatusBadge from '../StatusBadge'
import { FeishuIcon, GearIcon } from '../icons'

interface FeishuPanelProps {
  settings: UserSettings
  onUpdateSettings: (updater: (s: UserSettings) => UserSettings) => void
}

/**
 * 设置页「飞书授权」面板（UI 对齐 Agent 设置的 Section/Row 体系）：
 * - 应用凭证卡：左标签 + 右输入的「默认模型」式表单行（App ID / Secret + 显隐）+ 保存/清除
 * - 个人授权卡：我的 ADE 式行（图标容器 + 主文案 + 状态 pill + 行尾文字操作）
 */
export default function FeishuPanel({ settings, onUpdateSettings }: FeishuPanelProps) {
  const { feishu } = settings
  const [appIdDraft, setAppIdDraft] = useState(feishu.appId)
  const [secretDraft, setSecretDraft] = useState(feishu.appSecret)
  const [showSecret, setShowSecret] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)

  const dirty = appIdDraft !== feishu.appId || secretDraft !== feishu.appSecret
  const credSaved = !!feishu.appId.trim() && !!feishu.appSecret.trim()

  /** 保存凭证（同时清空授权态：换凭证需重新授权） */
  const handleSaveCred = () => {
    onUpdateSettings((s) => ({
      ...s,
      feishu: {
        ...s.feishu,
        appId: appIdDraft.trim(),
        appSecret: secretDraft.trim(),
        authorized: false,
        authorizedAt: '',
      },
    }))
  }

  /** 清除凭证 */
  const handleClearCred = () => {
    setAppIdDraft('')
    setSecretDraft('')
    onUpdateSettings((s) => ({
      ...s,
      feishu: { ...s.feishu, appId: '', appSecret: '', authorized: false, authorizedAt: '' },
    }))
  }

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
      {/* —— 应用凭证（「默认模型」式表单行） —— */}
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
            {dirty ? '有未保存的修改，保存后需重新授权' : '凭证用于「文档」导入的个人身份授权，仅本人可见'}
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

      {/* —— 个人授权（我的 ADE 式行） —— */}
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
                  ? `${feishu.authorizedAccount} · 授权于 ${feishu.authorizedAt}`
                  : credSaved
                    ? '授权后可在项目「文档」子 tab 从飞书目录导入文档'
                    : '请先配置并保存应用凭证'}
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
                disabled={authorizing || !credSaved || dirty}
                title={dirty ? '请先保存应用凭证' : !credSaved ? '请先配置并保存应用凭证' : '发起飞书个人授权'}
                onClick={handleAuthorize}
              >
                {authorizing ? '授权中…' : '去授权'}
              </button>
            )}
          </span>
        </Row>
      </Section>
    </div>
  )
}
