/** 安全审查域：类型 + 预设规则库 + Mock 命中池 + 审查生成函数（纯前端确定性 Mock） */

/* —— 类型定义 —— */

/** 严重级别 */
export type RuleSeverity = '高危' | '中危' | '低危' | '提示'

/** 匹配方式 */
export type RuleMatchType = '关键词' | '正则'

/** 审查规则（预设 + 自定义统一形态） */
export interface SecurityRule {
  id: string
  name: string
  /** 安全子类（预设规则徽标用）：密钥泄露/注入/XSS/加密/信息泄露/配置/依赖/规范 */
  tag: string
  severity: RuleSeverity
  description: string
  matchType: RuleMatchType
  /** 关键词或正则文本 */
  pattern: string
  /** 适用范围 */
  scope: string
  enabled: boolean
  /** 预设规则 = true：不可删除/不可改内容，仅可启停 */
  builtin: boolean
}

/** 审查发现的问题 */
export interface RuleFinding {
  id: string
  ruleId: string
  severity: RuleSeverity
  /** 文件路径 */
  file: string
  /** 行号 */
  line: number
  /** 命中代码片段（mono 展示） */
  snippet: string
  description: string
  suggestion: string
  status: '待处理' | '已修复' | '已忽略'
  handledAt?: string
}

/** 一次审查记录 */
export interface ReviewRecord {
  id: string
  trigger: '手动' | '定时' | 'MR'
  /** 审查范围（仓库 · 分支） */
  scope: string
  /** 'MM-DD HH:mm' */
  startedAt: string
  /** 耗时（秒，一位小数） */
  durationSec: number
  /** 扫描文件数 */
  scannedFiles: number
  /** 本次应用的规则数 */
  rulesApplied: number
  findings: RuleFinding[]
}

/** 定时审查规则（与自动化任务 ScheduleRule 同构） */
export interface SecuritySchedule {
  /** 频率 */
  freq: '每天' | '每周' | '每月'
  /** 时间 HH:mm */
  time: string
  /** 每周：星期几（1-7，1 = 周一） */
  weekday?: number
  /** 每月：几号（1-31） */
  day?: number
}

/** 星期展示名（下标 1-7 对应周一~周日） */
export const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 定时规则 → 展示文案（如「每天 08:00」「每周五 18:00」「每月 1 日 06:00」） */
export function securityScheduleText(rule: SecuritySchedule): string {
  switch (rule.freq) {
    case '每天': return `每天 ${rule.time}`
    case '每周': return `每周${WEEKDAY_NAMES[rule.weekday ?? 1]} ${rule.time}`
    case '每月': return `每月 ${rule.day ?? 1} 日 ${rule.time}`
  }
}

/** 扫描/阻断策略（紧凑条 + 定时审查配置） */
export interface SecurityPolicy {
  /** MR 阻断：存在高危问题时阻断合并请求 */
  blockMrOnHigh: boolean
  /** 自动创建 Issue：发现高危问题时自动在 GitLab 创建 Issue */
  autoIssue: boolean
  /** 扫描范围：全量 / 增量 / 全量+增量 */
  scanScope: '全量' | '增量' | '全量+增量'
  /** 定时审查：开启后按规则到点自动执行 */
  scheduledReview: boolean
  /** 定时审查规则 */
  schedule: SecuritySchedule
}

/** 安全审查域数据（挂 Project.security） */
export interface SecurityData {
  policy: SecurityPolicy
  rules: SecurityRule[]
  records: ReviewRecord[]
}

/* —— 常量 —— */

/** 扫描范围可选项 */
export const SCAN_SCOPES: SecurityPolicy['scanScope'][] = ['全量', '增量', '全量+增量']

/** 定时审查频率可选项 */
export const SCHEDULE_FREQS: SecuritySchedule['freq'][] = ['每天', '每周', '每月']

/** 时/分/星期/日期下拉选项（定时审查弹窗用） */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
export const MINUTE_OPTIONS = ['00', '15', '30', '45']
export const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7]
export const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1)

/** 严重级别可选项（新建/编辑规则弹窗用） */
export const RULE_SEVERITIES: RuleSeverity[] = ['高危', '中危', '低危', '提示']

/** 匹配方式可选项 */
export const RULE_MATCH_TYPES: RuleMatchType[] = ['关键词', '正则']

/** 适用范围下拉选项 */
export const RULE_SCOPES = ['全部文件', '前端 *.ts,*.tsx', '后端 *.java,*.py', '配置 *.yaml,*.json']

/* —— 预设安全规则库（10 条，默认全启用） —— */

export const PRESET_RULES: SecurityRule[] = [
  {
    id: 'sr-key', name: '硬编码密钥与凭证', tag: '密钥泄露', severity: '高危',
    description: '检测源码中硬编码的 password / token / api_key 等凭证',
    matchType: '关键词', pattern: 'password = · api_key = · secret = · token =',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'sr-sqli', name: 'SQL 注入风险', tag: '注入', severity: '高危',
    description: '检测字符串拼接构造 SQL 语句的注入风险',
    matchType: '关键词', pattern: '"SELECT * FROM " + · `WHERE ${` · query(.*+.*user',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'sr-xss', name: 'XSS 转义缺失', tag: 'XSS', severity: '高危',
    description: '检测 innerHTML / dangerouslySetInnerHTML 等未转义输出',
    matchType: '关键词', pattern: 'innerHTML = · dangerouslySetInnerHTML · document.write',
    scope: '前端 *.ts,*.tsx', enabled: true, builtin: true,
  },
  {
    id: 'sr-deser', name: '不安全的反序列化', tag: '注入', severity: '高危',
    description: '检测 pickle.loads / ObjectInputStream 等反序列化调用',
    matchType: '关键词', pattern: 'pickle.loads · yaml.load( · ObjectInputStream',
    scope: '后端 *.java,*.py', enabled: true, builtin: true,
  },
  {
    id: 'sr-weak-crypto', name: '弱加密算法', tag: '加密', severity: '中危',
    description: '检测 MD5 / DES / ECB 等弱加密算法的使用',
    matchType: '关键词', pattern: "createHash('md5') · DES · ECB · rc4",
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'sr-sensitive-log', name: '敏感信息日志输出', tag: '信息泄露', severity: '中危',
    description: '检测密码 / token 等敏感信息输出到日志',
    matchType: '关键词', pattern: 'console.log(password · log(token · print(secret',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'sr-cors', name: 'CORS 全开放', tag: '配置', severity: '中危',
    description: '检测 Access-Control-Allow-Origin: * 的宽松跨域配置',
    matchType: '关键词', pattern: 'Access-Control-Allow-Origin: *',
    scope: '配置 *.yaml,*.json', enabled: true, builtin: true,
  },
  {
    id: 'sr-path', name: '路径遍历风险', tag: '注入', severity: '中危',
    description: '检测用户输入拼接文件路径导致的目录穿越',
    matchType: '正则', pattern: 'readFile\\(.*\\.\\./ · require\\(.*\\.\\./',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'sr-dep', name: '已知漏洞依赖', tag: '依赖', severity: '中危',
    description: '检测依赖版本是否命中已知 CVE 漏洞库',
    matchType: '关键词', pattern: '依赖版本命中 CVE 库（lockfile 比对）',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'sr-debug', name: '调试代码残留', tag: '规范', severity: '低危',
    description: '检测 debugger 语句与调试日志残留',
    matchType: '关键词', pattern: 'debugger · console.debug',
    scope: '前端 *.ts,*.tsx', enabled: true, builtin: true,
  },
]

/* —— Mock 命中池（预设规则 → 示例问题；生成时补 id/ruleId/status） —— */

type PoolFinding = Omit<RuleFinding, 'id' | 'ruleId' | 'status' | 'handledAt'>

const FINDING_POOL: Record<string, PoolFinding[]> = {
  'sr-key': [
    {
      severity: '高危', file: 'src/api/config.ts', line: 18,
      snippet: "export const PAY_API_KEY = 'sk-live-9f2kx8dmd0slew'",
      description: '源码中硬编码了第三方支付服务 API Key，泄露后可被直接滥用。',
      suggestion: '将凭证迁移到环境变量或密钥管理服务，并轮换已泄露的 Key。',
    },
    {
      severity: '中危', file: 'scripts/sync-user.ts', line: 9,
      snippet: 'const password = "admin123456"',
      description: '脚本中硬编码了管理员密码。',
      suggestion: '改用环境变量注入，并在仓库历史中清理该密码。',
    },
  ],
  'sr-sqli': [
    {
      severity: '高危', file: 'server/user/dao.ts', line: 76,
      snippet: 'const sql = "SELECT * FROM users WHERE name = \'" + name + "\'"',
      description: '使用字符串拼接构造 SQL，用户输入未参数化，存在注入风险。',
      suggestion: '改用参数化查询或 ORM 的占位符绑定。',
    },
  ],
  'sr-xss': [
    {
      severity: '高危', file: 'src/utils/html.ts', line: 42,
      snippet: 'const Node = () => <div dangerouslySetInnerHTML={{ __html: userBio }} />',
      description: '使用 dangerouslySetInnerHTML 直接渲染未净化的 HTML，攻击者可注入恶意脚本。',
      suggestion: '渲染前使用 DOMPurify 净化 HTML，或改用文本节点输出。',
    },
  ],
  'sr-deser': [
    {
      severity: '高危', file: 'gateway/pay/callback.py', line: 31,
      snippet: 'data = pickle.loads(raw_body)',
      description: '对回调报文直接反序列化，恶意构造的 payload 可导致任意代码执行。',
      suggestion: '改用 JSON 等安全格式解析，禁止 pickle 处理外部输入。',
    },
  ],
  'sr-weak-crypto': [
    {
      severity: '中危', file: 'src/utils/crypto.ts', line: 27,
      snippet: "const hash = createHash('md5').update(data).digest('hex')",
      description: '使用 MD5 做数据摘要，存在碰撞攻击风险。',
      suggestion: '改用 SHA-256 及以上算法；涉及密码存储时使用 bcrypt / argon2。',
    },
  ],
  'sr-sensitive-log': [
    {
      severity: '中危', file: 'src/api/login.ts', line: 63,
      snippet: "console.log('login payload', { phone, password })",
      description: '登录流程将用户密码输出到控制台日志。',
      suggestion: '删除该日志，或对敏感字段脱敏后再输出。',
    },
  ],
  'sr-cors': [
    {
      severity: '中危', file: 'config/nginx.conf', line: 52,
      snippet: 'add_header Access-Control-Allow-Origin *;',
      description: '跨域配置对所有来源开放，任意站点可携带凭证访问接口。',
      suggestion: '改为显式白名单域名列表。',
    },
  ],
  'sr-path': [
    {
      severity: '中危', file: 'server/file/download.ts', line: 44,
      snippet: "const path = path.join(rootDir, req.query.name + '../../../etc/passwd')",
      description: '用户输入直接拼接文件路径，可构造 ../ 穿越到任意目录。',
      suggestion: '对拼接结果做 realpath 校验并限制在允许目录内。',
    },
  ],
  'sr-dep': [
    {
      severity: '中危', file: 'package.json', line: 38,
      snippet: '"lodash": "^4.17.20"  // CVE-2021-23337 命中',
      description: 'lodash 4.17.20 命中已知漏洞 CVE-2021-23337（命令注入）。',
      suggestion: '升级到 4.17.21 及以上版本。',
    },
  ],
  'sr-debug': [
    {
      severity: '低危', file: 'src/hooks/useForm.ts', line: 15,
      snippet: 'if (!values.name) { debugger ; return }',
      description: '残留 debugger 调试语句，生产环境会中断执行。',
      suggestion: '删除 debugger 语句，构建流程可加 eslint no-debugger 兜底。',
    },
  ],
}

/** 自定义规则命中池（按规则名关键词确定性命中，演示语义） */
const CUSTOM_POOL: PoolFinding[] = [
  {
    severity: '中危', file: 'src/utils/sandbox.ts', line: 22,
    snippet: 'const result = eval(userExpr)',
    description: '命中自定义规则：动态执行用户输入的表达式。',
    suggestion: '改用表达式解析器（如 expr-eval）替代 eval。',
  },
  {
    severity: '低危', file: 'src/views/RichText.vue', line: 8,
    snippet: '<div v-html="content"></div>',
    description: '命中自定义规则：模板使用 v-html 渲染富文本。',
    suggestion: '渲染前净化 HTML，或使用文本插值。',
  },
]

/* —— 工具函数 —— */

/** 简单确定性哈希（字符串 → 非负整数） */
function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

/** 当前时刻 'MM-DD HH:mm' */
export function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 新项目默认安全数据：默认策略 + 预设规则全启用 + 空记录 */
export function createDefaultSecurity(): SecurityData {
  return {
    policy: {
      blockMrOnHigh: true,
      autoIssue: true,
      scanScope: '全量+增量',
      scheduledReview: false,
      schedule: { freq: '每天', time: '06:00' },
    },
    rules: PRESET_RULES.map((r) => ({ ...r })),
    records: [],
  }
}

/**
 * 按启用规则生成一条审查记录（Mock，确定性）：
 * - 预设规则：各按相位（hash(ruleId) + 记录序号）命中池中 0–2 条；
 * - 自定义规则：按 hash(规则名) 相位命中自定义池 0–1 条；
 * - 保证同一规则集两次审查结果稳定，停用规则后其问题消失。
 */
export function buildReviewRecord(
  rules: SecurityRule[],
  scope: string,
  seq: number,
  trigger: ReviewRecord['trigger'] = '手动',
  startedAt?: string,
): ReviewRecord {
  const enabled = rules.filter((r) => r.enabled)
  const findings: RuleFinding[] = []
  let n = 0

  for (const rule of enabled) {
    const pool = rule.builtin ? (FINDING_POOL[rule.id] ?? []) : CUSTOM_POOL
    if (pool.length === 0) continue
    // 相位：决定该规则本次命中几条（0 ~ min(2, pool.length)）
    const phase = (hashOf(rule.id + rule.name) + seq) % 3
    const count = Math.min(pool.length, phase === 0 ? 0 : phase === 1 ? 1 : 2)
    for (let k = 0; k < count; k++) {
      const p = pool[(hashOf(rule.name) + k) % pool.length]
      findings.push({
        id: `f${Date.now()}-${n}`,
        ruleId: rule.id,
        severity: rule.builtin ? p.severity : rule.severity,
        file: p.file,
        line: p.line,
        snippet: p.snippet,
        description: p.description,
        suggestion: p.suggestion,
        status: '待处理',
      })
      n++
    }
  }

  // 严重度降序（高危 → 中危 → 低危 → 提示），同级按文件路径
  const sevRank: Record<RuleSeverity, number> = { 高危: 0, 中危: 1, 低危: 2, 提示: 3 }
  findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.file.localeCompare(b.file))

  return {
    id: `rec${Date.now()}`,
    trigger,
    scope,
    startedAt: startedAt ?? nowStamp(),
    durationSec: Math.round((2.8 + (hashOf(String(seq)) % 20) / 10) * 10) / 10,
    scannedFiles: 30 + (hashOf(scope + seq) % 12),
    rulesApplied: enabled.length,
    findings,
  }
}

/** 记录行次级统计（待处理口径） */
export interface FindingStats {
  total: number
  high: number
  mid: number
  low: number
  tip: number
}

/** 统计一条记录中待处理问题（按严重度） */
export function findingStats(record: ReviewRecord): FindingStats {
  const pending = record.findings.filter((f) => f.status === '待处理')
  return {
    total: pending.length,
    high: pending.filter((f) => f.severity === '高危').length,
    mid: pending.filter((f) => f.severity === '中危').length,
    low: pending.filter((f) => f.severity === '低危').length,
    tip: pending.filter((f) => f.severity === '提示').length,
  }
}

/** 记录行次级统计文案：应用规则 N 条 · 发现 M 个问题（高危 x · 中危 y · 低危 z） */
export function findingStatsText(record: ReviewRecord): string {
  const s = findingStats(record)
  const parts: string[] = []
  if (s.high) parts.push(`高危 ${s.high}`)
  if (s.mid) parts.push(`中危 ${s.mid}`)
  if (s.low) parts.push(`低危 ${s.low}`)
  if (s.tip) parts.push(`提示 ${s.tip}`)
  const detail = parts.length > 0 ? `（${parts.join(' · ')}）` : ''
  return `应用规则 ${record.rulesApplied} 条 · ${s.total > 0 ? `发现 ${s.total} 个问题${detail}` : '未发现问题'}`
}
