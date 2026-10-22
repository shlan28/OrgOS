import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutoJob, JobRun, MessageSender, Notification, Project, RunMessage, RunStep } from '../data/projects'
import { ADE_SENDER, CURRENT_USER, memberColorOf, stepResultOf } from '../data/projects'

/** 活动状态（可取消运行/可发消息/可暂停） */
const ACTIVE_STATUSES = ['排队中', '运行中', '等待确认', '等待输入', '已暂停']

export const isActiveRun = (run?: JobRun): run is JobRun =>
  !!run && ACTIVE_STATUSES.includes(run.status)

/** 每步推进间隔（毫秒） */
const STEP_INTERVAL = 4000

/** ADE 对人插话的回应延迟（毫秒） */
const REPLY_DELAY = 1500

/** 通用步骤模板（手动触发/新建任务运行时使用） */
const GENERIC_STEPS = ['拉取代码', '静态检查', '执行任务', '输出报告']

const nowTime = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const nowStamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `08-28 ${p(d.getHours())}:${p(d.getMinutes())}`
}

const runId = () => `r${Date.now()}`

const msgId = () => `m${Date.now()}${Math.floor(Math.random() * 1000)}`

const msg = (role: RunMessage['role'], text: string): RunMessage => ({
  id: msgId(), role, text, time: nowTime(),
  sender: role === 'ADE' ? ADE_SENDER : role === '人' ? CURRENT_USER : undefined,
})

/** Gate 处理人：项目负责人优先，找不到回退当前用户 */
const gateApproverOf = (project: Project | undefined): MessageSender => {
  const owner = project?.members.find((m) => m.permission === '项目负责人')
  if (owner) return { name: owner.name, initial: owner.initial, color: memberColorOf(owner.name) }
  return CURRENT_USER
}

export interface AutomationEngine {
  /** 更新项目数据（面板写操作入口） */
  updateProject: (projectId: string, updater: (p: Project) => Project) => void
  /** 通知列表 */
  notifications: Notification[]
  /** 批准等待确认的运行 */
  approve: (projectId: string, jobId: string) => void
  /** 拒绝等待确认的运行 */
  reject: (projectId: string, jobId: string) => void
  /** 提交输入型表单并继续运行 */
  submit: (projectId: string, jobId: string, values: Record<string, string>) => void
  /** 取消活动中的运行（停止 → 回到未运行态） */
  cancel: (projectId: string, jobId: string) => void
  /** 手动触发一次运行 */
  trigger: (projectId: string, jobId: string) => void
  /** 人向运行中的任务发消息（ADE 会回应） */
  sendMessage: (projectId: string, jobId: string, text: string) => void
  /** 暂停运行中的运行 */
  pause: (projectId: string, jobId: string) => void
  /** 从暂停处继续运行 */
  resume: (projectId: string, jobId: string) => void
  /** 从头重新运行（放弃当前运行，立即重启） */
  restart: (projectId: string, jobId: string) => void
}

/**
 * Mock 自动化运行引擎：
 * - 用 setTimeout 链模拟步骤推进（每 4s 一步），过程以消息流呈现；
 * - needApproval 的任务运行到中点暂停为「等待确认」并产生通知；
 * - Gate 被处理后继续推进至「成功」；
 * - 人可随时向活动运行发消息，ADE 约 1.5s 后回应；
 * - 组件卸载时清理全部定时器。
 */
export function useAutomationEngine(
  projects: Project[],
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>,
): AutomationEngine {
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: 'n1', type: '等待确认', jobId: 'j3', runId: 'r12', projectId: 'loomweb',
      title: '周报生成 · 运行 #r12',
      description: '即将把周报发布到外部渠道，请确认内容无误。',
      time: '5 分钟前',
      approver: { name: 'shilu', initial: 'S', color: '#5b7ba6' },
    },
    {
      id: 'n2', type: '等待输入', jobId: 'j4', runId: 'r13', projectId: 'loomweb',
      title: '发布准备 · 运行 #r13',
      description: '发布前请补充版本号与发布说明。',
      time: '12 分钟前',
      approver: { name: 'luyu', initial: 'L', color: '#3f8f5f' },
    },
  ])

  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const projectsRef = useRef(projects)
  projectsRef.current = projects

  useEffect(() => {
    const set = timers.current
    return () => {
      set.forEach(clearTimeout)
      set.clear()
    }
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])

  /** 更新指定项目的指定任务 */
  const updateJob = useCallback((
    projectId: string,
    jobId: string,
    updater: (job: AutoJob) => AutoJob,
  ) => {
    setProjects((list) => list.map((p) => p.id !== projectId ? p : ({
      ...p,
      autoJobs: p.autoJobs.map((j) => j.id === jobId ? updater(j) : j),
    })))
  }, [setProjects])

  /** 更新当前运行（仅当仍是同一次运行时生效，防止过期定时器写脏数据） */
  const updateRun = useCallback((
    projectId: string,
    jobId: string,
    runIdStr: string,
    updater: (run: JobRun) => JobRun,
  ) => {
    updateJob(projectId, jobId, (job) => {
      if (!job.currentRun || job.currentRun.id !== runIdStr) return job
      return { ...job, currentRun: updater(job.currentRun) }
    })
  }, [updateJob])

  /** 产生通知 */
  const pushNotification = useCallback((n: Notification) => {
    setNotifications((list) => [n, ...list])
  }, [])

  /** 清除某次运行对应的通知 */
  const clearNotification = useCallback((runIdStr: string) => {
    setNotifications((list) => list.filter((n) => n.runId !== runIdStr))
  }, [])

  /** 推进一次运行：完成当前步骤，视情况进入下一步/等待/终态 */
  const advanceRun = useCallback((projectId: string, jobId: string, runIdStr: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || run.id !== runIdStr || run.status !== '运行中') return

    const idx = run.currentStep
    const step = run.steps[idx]
    if (!step) return

    // 1. 完成当前步骤（附带阶段性结果：摘要 + 产物文件 + 会话跳转）
    const doneStep: RunStep = { ...step, status: '成功', time: nowTime() }
    const steps = run.steps.map((s, i) => (i === idx ? doneStep : s))
    const messages = [...run.messages, {
      ...msg('ADE', `${step.name}完成。`),
      result: stepResultOf(step.name, runIdStr, idx),
    }]

    // 2. 判断是否到达人工介入点（needApproval 任务在中点暂停）
    const nextIdx = idx + 1
    const midPoint = Math.floor(run.steps.length / 2)
    const shouldGate = job.needApproval && nextIdx === midPoint && run.steps.length > 1

    if (shouldGate) {
      const gateDesc = `「${job.name}」已运行至中点（${run.steps[nextIdx]?.name ?? ''}），请确认是否继续。`
      const approver = gateApproverOf(project)
      updateRun(projectId, jobId, runIdStr, (r) => ({
        ...r,
        steps,
        messages: [
          ...messages,
          {
            ...msg('ADE', gateDesc),
            actions: [
              { label: '拒绝', kind: 'default' },
              { label: '批准', kind: 'primary' },
            ],
          },
        ],
        currentStep: nextIdx,
        status: '等待确认',
        waitingSince: '刚刚',
        gate: { type: '确认', title: '运行确认', description: gateDesc, approver },
      }))
      pushNotification({
        id: `n${Date.now()}`, type: '等待确认', jobId, runId: runIdStr, projectId,
        title: `${job.name} · 运行 #${runIdStr}`,
        description: gateDesc,
        time: '刚刚',
        approver,
      })
      return
    }

    // 3. 是否还有下一步
    if (nextIdx < run.steps.length) {
      updateRun(projectId, jobId, runIdStr, (r) => ({
        ...r,
        steps: steps.map((s, i) => (i === nextIdx ? { ...s, status: '运行中' } : s)),
        messages: [...messages, msg('ADE', `开始执行：${run.steps[nextIdx].name}`)],
        currentStep: nextIdx,
      }))
      later(() => advanceRun(projectId, jobId, runIdStr), STEP_INTERVAL)
      return
    }

    // 4. 全部完成 → 成功，归档进历史
    const finished: JobRun = {
      ...run,
      steps,
      messages: [...messages, msg('系统', '运行成功结束')],
      status: '成功',
      finishedAt: nowStamp(),
      gate: undefined,
      waitingSince: undefined,
    }
    updateJob(projectId, jobId, (j) => ({
      ...j,
      currentRun: undefined,
      history: [finished, ...j.history].slice(0, 3),
    }))
  }, [later, pushNotification, updateJob, updateRun])

  /** 启动一次新运行 */
  const startRun = useCallback((projectId: string, jobId: string, stepNames?: string[]) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    if (!job || job.currentRun) return

    const names = stepNames ?? job.history[0]?.steps.map((s) => s.name) ?? GENERIC_STEPS
    const id = runId()
    const run: JobRun = {
      id,
      jobId,
      status: '运行中',
      startedAt: nowStamp(),
      currentStep: 0,
      steps: names.map((name, i) => ({ id: `st${i}`, name, status: i === 0 ? '运行中' : '等待' })),
      messages: [msg('系统', `运行开始：${job.name}`)],
    }
    updateJob(projectId, jobId, (j) => ({ ...j, currentRun: run }))
    later(() => advanceRun(projectId, jobId, id), STEP_INTERVAL)
  }, [advanceRun, later, updateJob])

  // 初始场景：每日构建正在运行（步骤 2/4），挂载后继续推进
  // 注：StrictMode 下 effect 会执行两次，用 ref 标记保证只调度一次
  const bootstrapped = useRef(false)
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    const loomweb = projectsRef.current.find((p) => p.id === 'loomweb')
    const build = loomweb?.autoJobs.find((j) => j.id === 'j1')
    if (build?.currentRun && build.currentRun.status === '运行中') {
      const id = build.currentRun.id
      later(() => advanceRun('loomweb', 'j1', id), STEP_INTERVAL)
    }
  }, [advanceRun, later])

  const approve = useCallback((projectId: string, jobId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || run.status !== '等待确认') return

    clearNotification(run.id)
    updateRun(projectId, jobId, run.id, (r) => ({
      ...r,
      status: '运行中',
      gate: undefined,
      waitingSince: undefined,
      messages: [
        ...r.messages.map((m) => (m.actions ? { ...m, actions: undefined } : m)),
        msg('系统', '人工批准，继续运行'),
      ],
    }))
    later(() => advanceRun(projectId, jobId, run.id), STEP_INTERVAL)
  }, [advanceRun, clearNotification, later, updateRun])

  const reject = useCallback((projectId: string, jobId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || run.status !== '等待确认') return

    clearNotification(run.id)
    const rejected: JobRun = {
      ...run,
      status: '已拒绝',
      finishedAt: nowStamp(),
      gate: undefined,
      waitingSince: undefined,
      messages: [
        ...run.messages.map((m) => (m.actions ? { ...m, actions: undefined } : m)),
        msg('系统', '人工拒绝，运行终止'),
      ],
    }
    updateJob(projectId, jobId, (j) => ({
      ...j,
      currentRun: undefined,
      history: [rejected, ...j.history].slice(0, 3),
    }))
  }, [clearNotification, updateJob])

  const submit = useCallback((projectId: string, jobId: string, values: Record<string, string>) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || run.status !== '等待输入') return

    clearNotification(run.id)
    const summary = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('，')
    updateRun(projectId, jobId, run.id, (r) => ({
      ...r,
      status: '运行中',
      gate: undefined,
      waitingSince: undefined,
      messages: [
        ...r.messages.map((m) => (m.form ? { ...m, form: undefined } : m)),
        msg('系统', `收到人工输入（${summary}），继续运行`),
      ],
    }))
    later(() => advanceRun(projectId, jobId, run.id), STEP_INTERVAL)
  }, [advanceRun, clearNotification, later, updateRun])

  const cancel = useCallback((projectId: string, jobId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || !isActiveRun(run)) return

    clearNotification(run.id)
    const cancelled: JobRun = {
      ...run,
      status: '已取消',
      finishedAt: nowStamp(),
      gate: undefined,
      waitingSince: undefined,
      messages: [...run.messages, msg('系统', '人工取消运行')],
    }
    updateJob(projectId, jobId, (j) => ({
      ...j,
      currentRun: undefined,
      history: [cancelled, ...j.history].slice(0, 3),
    }))
  }, [clearNotification, updateJob])

  const trigger = useCallback((projectId: string, jobId: string) => {
    startRun(projectId, jobId)
  }, [startRun])

  /** 暂停：当前步骤保持「运行中」标记但整体置为已暂停（推进定时器到点时发现非运行中会自动跳过） */
  const pause = useCallback((projectId: string, jobId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || run.status !== '运行中') return

    updateRun(projectId, jobId, run.id, (r) => ({
      ...r,
      status: '已暂停',
      messages: [...r.messages, msg('系统', '人工暂停，运行挂起')],
    }))
  }, [updateRun])

  /** 继续：从暂停处恢复推进 */
  const resume = useCallback((projectId: string, jobId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || run.status !== '已暂停') return

    updateRun(projectId, jobId, run.id, (r) => ({
      ...r,
      status: '运行中',
      messages: [...r.messages, msg('系统', '人工恢复，继续运行')],
    }))
    later(() => advanceRun(projectId, jobId, run.id), STEP_INTERVAL)
  }, [advanceRun, later, updateRun])

  /** 重头运行：当前运行作废（不归档），立即从第一步重新启动 */
  const restart = useCallback((projectId: string, jobId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    if (!job || !job.currentRun) return

    updateJob(projectId, jobId, (j) => ({ ...j, currentRun: undefined }))
    // 同一事件里 ref 仍是旧值（React 批处理未刷新），延迟一拍待 currentRun 清除后再启动
    later(() => startRun(projectId, jobId), 0)
  }, [later, startRun, updateJob])

  /** 人向运行中的任务发消息：立即上屏，ADE 约 1.5s 后回应 */
  const sendMessage = useCallback((projectId: string, jobId: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const project = projectsRef.current.find((p) => p.id === projectId)
    const job = project?.autoJobs.find((j) => j.id === jobId)
    const run = job?.currentRun
    if (!job || !run || !isActiveRun(run)) return

    updateRun(projectId, jobId, run.id, (r) => ({
      ...r,
      messages: [...r.messages, msg('人', trimmed)],
    }))

    later(() => {
      const replies = [
        `收到，已记录：${trimmed.length > 20 ? `${trimmed.slice(0, 20)}…` : trimmed}`,
        '好的，将在后续步骤中应用。',
        '明白，已同步给相关执行环节。',
      ]
      const reply = replies[Math.floor(Math.random() * replies.length)]
      updateRun(projectId, jobId, run.id, (r) => ({
        ...r,
        messages: [...r.messages, msg('ADE', reply)],
      }))
    }, REPLY_DELAY)
  }, [later, updateRun])

  return {
    updateProject: (projectId, updater) => setProjects((list) => list.map((p) => (p.id === projectId ? updater(p) : p))),
    notifications,
    approve,
    reject,
    submit,
    cancel,
    trigger,
    sendMessage,
    pause,
    resume,
    restart,
  }
}
