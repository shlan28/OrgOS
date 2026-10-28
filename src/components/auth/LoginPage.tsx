import { useState } from 'react'
import SegmentedControl from '../SegmentedControl'
import { authApi, type AuthUser } from '../../lib/authApi'
import './LoginPage.css'

interface LoginPageProps {
  needsSetup: boolean
  feishuConfigured: boolean
  onAuthenticated: (user: AuthUser) => void
}

type LoginTab = 'account' | 'feishu'

/** 登录页：账号登录（管理员）/ 飞书扫码登录 */
export default function LoginPage({ needsSetup, feishuConfigured, onAuthenticated }: LoginPageProps) {
  const [tab, setTab] = useState<LoginTab>('account')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isSetup = needsSetup

  const submitAccount = async () => {
    if (busy) return
    setError('')
    if (isSetup && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const { user } = isSetup
        ? await authApi.setup(username, password)
        : await authApi.login(username, password)
      onAuthenticated(user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  const openFeishu = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const res = await authApi.feishuUrl()
      if (!res.configured || !res.url) {
        setError('飞书登录尚未配置：需要 App ID/Secret、网页应用登录权限与重定向地址（FEISHU_REDIRECT_URI）')
        return
      }
      window.location.href = res.url
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法打开飞书登录')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo">O</span>
          <div>
            <h1 className="login-title">Org-OS</h1>
            <p className="login-sub">面向组织的 Agent 平台</p>
          </div>
        </div>

        <SegmentedControl
          value={tab}
          onChange={(v) => { setTab(v as LoginTab); setError('') }}
          items={[
            { key: 'account', label: '账号登录', icon: null },
            { key: 'feishu', label: '飞书登录', icon: null },
          ]}
        />

        {tab === 'account' ? (
          <div className="login-form">
            {isSetup && (
              <p className="login-hint">首次使用：创建管理员账号后即可进入</p>
            )}
            <label className="login-field">
              <span>用户名</span>
              <input
                className="field-input"
                value={username}
                autoFocus
                autoComplete="username"
                placeholder={isSetup ? '设置管理员用户名' : '管理员用户名'}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="login-field">
              <span>密码</span>
              <input
                className="field-input"
                type="password"
                value={password}
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                placeholder={isSetup ? '至少 6 位' : '密码'}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isSetup) submitAccount() }}
              />
            </label>
            {isSetup && (
              <label className="login-field">
                <span>确认密码</span>
                <input
                  className="field-input"
                  type="password"
                  value={confirm}
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitAccount() }}
                />
              </label>
            )}
            <button
              type="button"
              className="login-submit"
              disabled={busy || !username.trim() || !password || (isSetup && !confirm)}
              onClick={submitAccount}
            >
              {busy ? '处理中…' : isSetup ? '创建管理员并登录' : '登录'}
            </button>
          </div>
        ) : (
          <div className="login-feishu">
            <p className="login-feishu-title">飞书登录</p>
            <p className="login-feishu-sub">
              {feishuConfigured
                ? '点击下方按钮跳转到飞书授权页，使用飞书 App 扫码完成登录'
                : '飞书登录尚未配置，请先在组织设置中保存企业应用凭证，并配置重定向地址'}
            </p>
            <button
              type="button"
              className="login-submit ghost"
              disabled={busy || !feishuConfigured}
              onClick={openFeishu}
            >
              {busy ? '跳转中…' : '跳转飞书授权'}
            </button>
          </div>
        )}

        {error && <p className="login-error">{error}</p>}

        <p className="login-foot">
          {isSetup ? '首次使用将创建管理员账号（组织所有者）' : '管理员账号由组织维护'}
        </p>
      </div>
    </div>
  )
}
