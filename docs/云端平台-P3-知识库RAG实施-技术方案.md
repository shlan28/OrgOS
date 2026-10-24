# 云端平台 P3：知识库与 RAG 实施技术方案

> 创建日期：2026-10-23
> 归属：`docs/云端Agent协作平台-总体技术方案.md` 第 5 章（项目上下文）与第 14 章 P3 阶段的展开
> 目标：用轻量自建方案达到可度量的检索质量，不引入 RAGFlow / Dify 等重型平台

## 1. 结论与范围

### 1.1 结论

**自建轻量管道。** 用 `pgvector + Postgres 全文 + 重排 API + 现成解析库`，不引入第二套产品栈。

理由：

| 维度 | 自建轻量 | RAGFlow / Dify |
|---|---|---|
| 与现有架构 | 同库（Postgres）、同进程（worker），无新栈 | 多一套 Python + ES/Infinity + MySQL + MinIO |
| 资源 | +0.2–0.4 GB RAM | +6–12 GB RAM，磁盘 +50 GB 起 |
| 权限/多租户 | 直接复用现有 RBAC 与项目隔离 | 需要二次对接，且与本产品重复 |
| 检索质量 | 取决于六个杠杆 + 评测（可控） | 开箱较好，但难按场景深度定制 |
| 主要短板 | 复杂版面解析需自己接 | — |

**短板补法**：复杂 PDF / 扫描件 / 表格单独接 MinerU 或 Docling，只借解析能力，不搬平台。

### 1.2 什么时候应该放弃自建

出现以下任一情况，重新评估引入平台：

1. 扫描件 / 复杂表格 / 影印件占语料 **30% 以上**；
2. 需要给**非工程用户**一个独立的知识库运营后台（上传、标注、切分预览、命中调试）；
3. 语料规模超出单机 pgvector 的舒适区（千万 chunk 级）或需要跨库联邦检索；
4. 团队没有人力长期维护索引管道与评测。

**决策方式**：先按本方案做 2 周基线并产出评测数字，用数据决定是否升级，而不是现在拍板。

### 1.3 P3 范围

包含：文件解析 → 切分 → 嵌入 → 索引 → 混合检索 → 重排 → 引用 → 评测。
不包含：知识库前端 UI（属 P3 并行项）、记忆与反思（P5）、规范注入（随文件管理实现）。

---

## 2. 总体架构

```
文件系统 / 飞书同步 / API 写入
   │ 事件（file.changed / doc.synced）
   ▼
Ingestion Queue (BullMQ)
   ├─ Parser      按类型解析：md / code / pdf / txt
   ├─ Chunker     结构感知切分（不跨标题/函数）
   ├─ Enricher    上下文前缀（路径 + 标题链；可选 LLM 摘要）
   └─ Embedder    API 批量嵌入（带重试与限流）
        │
        ▼
Postgres
   ├─ kb_documents   文档元数据与索引状态
   ├─ kb_chunks      片段 + 向量 + 全文索引
   └─ eval_*         黄金集、运行记录、错误归类

检索（同步，<300ms 目标）
   query → 项目过滤 → 向量召回 50 + 全文召回 50 → RRF 融合
         → 重排取 8 → 父文档回填 → 带引用返回

消费方
   ├─ Agent MCP 工具 search_knowledge / read_file / list_specs
   └─ 网页知识库面板（搜索、预览、引用跳转）
```

---

## 3. 数据模型

> 2026-10-23：文档登记表已改为飞书方案的 `documents`（见 [飞书文档接入方案 §3](云端平台-飞书文档接入-技术方案.md)）；本节 `kb_documents` 视为其早期版本，`kb_chunks.document_id` 对应 `documents.id`，其余字段（切分、向量、索引状态）不变。

```sql
-- 文档：以「项目 + 路径」为唯一键
create table kb_documents (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id),
  path            text not null,
  kind            text not null,              -- markdown | code | pdf | text
  content_hash    text not null,
  size_bytes      bigint not null,
  source_updated_at timestamptz,
  index_status    text not null default 'pending',  -- pending | indexing | indexed | failed
  index_error     text,
  indexed_at      timestamptz,
  updated_at      timestamptz not null default now(),
  unique (project_id, path)
);
create index on kb_documents (project_id, index_status);

-- 片段：嵌入模型写入列，便于换模型时灰度重嵌
create table kb_chunks (
  id              bigserial primary key,
  document_id     uuid not null references kb_documents(id) on delete cascade,
  project_id      uuid not null,
  ordinal         int  not null,
  section_path    text[] not null default '{}', -- ['规范','发布','Gate 审批']
  content         text not null,
  context_prefix  text,                          -- 嵌入用前缀，不返回给用户
  tokens          int  not null,
  content_hash    text not null,
  embedding       vector(1024),
  embedding_model text not null,
  created_at      timestamptz not null default now()
);
create index on kb_chunks (document_id, ordinal);
create index on kb_chunks (project_id);
create index on kb_chunks using hnsw (embedding vector_cosine_ops);

-- 全文索引：中文需 zhparser / pg_jieba，见 §7
alter table kb_chunks add column tsv tsvector
  generated always as (to_tsvector('chinese', content)) stored;
create index on kb_chunks using gin (tsv);

-- 评测集（也可只存文件，入库便于按版本跑）
create table eval_cases (
  id          text primary key,          -- kb-0001
  version     text not null,             -- v1
  split       text not null,             -- dev | test
  project_id  uuid not null,
  query       text not null,
  query_type  text not null,
  difficulty  text not null,
  expected    jsonb not null,            -- [{file, section, lines}]
  must_not    jsonb not null default '[]',
  answer_key  text,
  source      text not null default 'real',  -- real | synthetic
  tags        text[] not null default '{}'
);

create table eval_runs (
  id          uuid primary key default gen_random_uuid(),
  pipeline    text not null,             -- vector | hybrid | hybrid+rerank
  golden_version text not null,
  metrics     jsonb not null,
  report_path text,
  created_at  timestamptz not null default now()
);

create table eval_case_results (
  run_id      uuid references eval_runs(id) on delete cascade,
  case_id     text not null,
  retrieved   jsonb not null,
  hit_at      jsonb not null,            -- {5:true,10:true,20:false}
  rank        int,
  error_type  text,                      -- 见 §6.4
  primary key (run_id, case_id)
);

-- 线上信号：用于扩充黄金集
create table retrieval_logs (
  id            bigserial primary key,
  project_id    uuid not null,
  session_id    uuid,
  query         text not null,
  expanded_query text,
  top_paths     text[] not null,
  result_count  int not null,
  clicked_path  text,                    -- 用户/Agent 是否读原文
  reformulated  boolean default false,   -- 同会话内再次检索
  created_at    timestamptz not null default now()
);
```

---

## 4. 索引管道

### 4.1 触发

- 文件写入 / 删除 / 重命名 → `file.changed` 事件；
- 事件只带 `project_id + path`，worker 按 `content_hash` 判定是否需要重索引；
- 删除文档 → 事务内删除 `kb_chunks`（`on delete cascade`）+ 触发向量索引清理；
- 批量导入 → 合并为一次批任务，避免每条文件一个 job。

**索引范围（知识库是视图，不是存储位置）**

| 来源 | 条件 | 说明 |
|---|---|---|
| 飞书文档 | 项目飞书文件夹内的 docx | 拉 blocks → markdown → 切分；记录 `revision` |
| 飞书 Office | docx / xlsx / pptx / pdf | 导出后解析 → 切分；记录 `revision` |
| 项目规范 | 注入提示词的规范文档 | 直接索引 |
| 附件区 | `index_policy='off'` | 默认跳过 |

> **「项目知识库」不是独立来源**：它就是上述文档的索引视图，收录范围由 `documents.index_policy` 决定，不另存一份。

**仓库文档的 include / exclude**

```yaml
include:
  - README*
  - docs/**
  - adr/**
  - "*.md"          # 仅根目录
exclude:
  - node_modules/**
  - dist/**
  - build/**
  - "**/generated/**"
  - "**/CHANGELOG.md"   # 可选：避免长变更流水占用索引
```

- push webhook → 拉取变更文件列表 → 只对命中的文档发 `file.changed`；
- 引用必须带 `repo + path + commit`，便于跳转到对应版本；
- 仓库分支删除或文件移除 → 软删对应 `files` 记录并清理 `chunks`。

### 4.2 切分方案

#### 4.2.0 设计原则

1. **结构优先，长度其次**：先按文档自身结构切（标题 / 函数 / 版面块），再在结构单元内按长度二次切分。**绝不为凑 token 数切断语义单元**。
2. **可引用**：每个片段必须能映射回原文行号或页码，否则无法给出可信引用。
3. **可回填**：片段保留父级（section / 文档）指针，命中后可扩展到父段补足上下文。
4. **确定性**：相同输入必须产生相同切分。否则每次重建索引 ID 全变，无法增量、无法评测对比。
5. **不跨边界**：标题、列表、表格、代码块不拆开（超过上限时的例外见 4.2.2）。
6. **冗余头部**：嵌入时拼接「路径 + 标题链」前缀，返回给用户时用原文。

#### 4.2.1 层级

```
Document
  └─ Section          标题树 / 版面章节 / 文件模块
      └─ Block       段落 / 列表 / 表格 / 代码块
          └─ Chunk   打包后的检索单元（400–800 token）
```

切分目标是 **Chunk**，但边界对齐到 Section 与 Block。Section 同时作为父文档回填的单位。

#### 4.2.2 分类型规则

| 类型 | 解析器 | 一级边界 | 超长时的二次切分 | 永不拆开 |
|---|---|---|---|---|
| **markdown** | 标题树 | 每个标题节点 = Section | 按 Block（段落 / 列表 / 代码块 / 表格）打包 | 代码围栏、表格、列表（顶层项为界） |
| **代码** | tree-sitter | 每个函数 / 类 / 方法 = Section | 按语句块切，标记 `part i/n` | 函数签名 + docstring |
| **PDF** | MinerU / Docling | 版面块 + 标题启发式 | 按段落切；表格按行组切并重复表头 | 表格 + 表题、图 + 图注 |
| **纯文本** | 段落 | 空行分段 | 按段落打包 | 单段落（超限才切） |
| **JSON / YAML / CSV** | 结构化解析 | 顶层键 / 行组 | 行组切分并重复表头 | 单条记录 |

具体规则：

**markdown**
- Section 大小 ≤ `maxTokens` 时**整节一个 chunk**，不强行再切；
- 超长时按顶层 Block 打包，`overlap` 只在同一 Section 内、且只在散文段落之间生效；
- 每个 chunk 嵌入文本前加 `路径 › 标题1 › 标题2`；正文首行重复当前标题文本，便于命中标题词；
- frontmatter 作为文档级元数据，不进正文；HTML 注释与徽章剥离。

**代码**
- `tree-sitter` 按语言解析出函数 / 类 / 方法的精确行范围；
- 文件头（imports + 顶层常量 + 文件注释）单独一块，作为「模块概览」；
- 嵌入前缀包含 `路径 + 类名/命名空间`，解决「多个文件都有 `handle()`」的歧义；
- 巨型函数按语句块切分，每块保留函数签名（而不是 docstring 全文）；
- 语言不支持时降级为「按空行分段 + 行窗口」，但**不按字符窗口**。

**PDF**
- 解析器必须输出 block 的页码与阅读顺序（多栏文档靠它）；
- 标题靠字号 / 加粗 / 编号模式识别，识别不到就把整页当一个 Section；
- 表格整块保留，超过上限按行组切并重复表头与表题；
- 图片只索引图注与 OCR 文本，图片本体走对象存储，不进 chunk。

#### 4.2.3 打包算法

```
buildChunks(doc):
  units    = parse(doc)                       // Block[]：type, text, lines|pages, sectionPath
  sections = groupBySection(units)
  for section in sections:
    if tokens(section) <= MAX: emit(whole(section))
    else:                      emitAll(packBlocks(section.blocks))

packBlocks(blocks):
  buf = []
  for b in blocks:
    if tokens(b) > MAX:
      emitAll(flush(buf)); buf = []
      emit(splitOversized(b))                 // 递归；表格/代码超限则整块保留
    else:
      if tokens(buf) + tokens(b) > MAX:
        emit(pack(buf))
        buf = tailOverlap(buf)                // 仅散文：取末尾 OVERLAP token
      buf.push(b)
  emitAll(flush(buf))
```

要点：

- **先填满再切**：按 Block 装箱，避免出现大量 50 token 的碎片；
- **overlap 有边界**：只在同一 Section、同一 Block 类型的连续散文之间重叠；跨标题、跨代码块不重叠；
- **超限的原子块允许保留**：一张 1200 token 的表格宁可超限，也不要切成无法理解的碎片；检索时靠重排与父文档回填补偿。

#### 4.2.4 参数

```ts
const CHUNK = {
  targetTokens: 500,      // 期望值，装箱时用
  maxTokens: 800,         // 硬上限（原子块例外）
  minTokens: 40,          // 低于此值并入相邻块，避免碎片
  overlapTokens: 60,      // 约 10–15%，仅散文
  neverCrossSection: true,
  tokenizer: 'model',     // 用嵌入模型的 tokenizer 计数，不用字符数
}
```

**为什么是 500**：一个 500 token 的片段通常正好覆盖「一个小节讲清楚的一件事」，既够回答，又不稀释向量语义。中文不能按字符估算，必须用模型 tokenizer（约 1 token ≈ 1.5–2 个汉字，偏差很大）。

#### 4.2.5 确定性与增量

- chunk 身份：`sha1(document_id + section_path.join('/') + block_ordinal + content_hash)`；
- **Section 级内容 hash 未变 → 直接复用旧 chunk 与向量**，只重算变化的 Section；
- 这就是为什么边界要对齐 Section 而不是固定窗口：固定窗口下插入一段话会让后面所有 chunk 全部偏移，导致全量重嵌（成本与时间都失控）；
- 文档删除 / 重命名 → 级联删除 chunk，并清理向量索引。

#### 4.2.6 父文档与回填

- 每个 chunk 记录 `section_path` 与父 Section 的 token 数；
- 命中后若父 Section ≤ `parentExpandMaxTokens`（默认 1200），直接返回整节；
- 超过则返回命中块 + 前后相邻块，并标注 `truncated`；
- 回填发生在**重排之后**，避免父文档撑大重排的输入。

#### 4.2.7 排除与降噪

以下内容不进索引（对检索是纯噪声）：

- 依赖与产物目录：`node_modules`、`dist`、`build`、`.git`、`vendor`；
- 锁文件与压缩产物：`*.lock`、`min.js`、`*.map`；
- 二进制与媒体：图片、音视频、压缩包；
- 高频重复样板：版权头、导航文本 —— 按 chunk 内容 hash 出现频次识别，超过阈值只保留一份；
- 空文档与纯空白 → `index_status='indexed'` 但 0 chunk，计入对账而非失败。

#### 4.2.8 怎么判断切分好不好

切分问题不会直接报错，只会表现为「检索不准」。用两类手段定位：

**离线不变量检查**（每次索引后跑）：

| 检查 | 预期 |
|---|---|
| 超限 chunk 占比 | 仅来自原子块（表格/代码），且 < 5% |
| 跨 Section 的 chunk | 0 |
| 缺 `lines` / `pages` 的 chunk | 0 |
| 碎片率（< minTokens） | < 2% |
| 覆盖率 | 各 chunk 去重叠拼接 ≈ 原文（误差 < 2%） |
| 重复率 | 完全相同内容的 chunk 占比 < 1% |

**检索侧诊断**：评测里 `Recall@10` 高但 `SectionRecall@10` 低，说明「文件找对了、片段切错了」——这就是 `boundary` 错误类型，优先调切分而不是调模型。

**调参方式**：用黄金集跑 400 / 500 / 700 三档，只看 dev split 的 nDCG@10 与 SectionRecall@10，选最优再冻结。不要凭感觉定。

#### 4.2.9 常见错误

| 错误做法 | 后果 |
|---|---|
| 按固定字符数切 | 切断代码与表格；中文长度完全失真 |
| 所有内容都加重叠 | 上下文里出现重复片段，浪费 token 且干扰重排 |
| 整篇文档当一个 chunk | 向量被平均，精度崩塌 |
| 每次改动全量重切 | 嵌入成本与索引时间随文件数线性上升 |
| 把标题只放在正文里不放进嵌入前缀 | 跨文档同名小节无法区分 |

### 4.3 上下文前缀（Enricher）

每个片段在嵌入前拼接：

```
{项目名} › {目录路径} › {标题链}
{正文}
```

只对嵌入生效，**返回给用户时用原文**。这一步成本几乎为零，但能显著改善「同名标题跨文档」的歧义。

可选（阶段 4）：让 LLM 为片段生成一句「这段在讲什么、解决什么问题」，再拼进嵌入文本（Contextual Retrieval）。索引成本一次性，召回提升明显。

### 4.4 嵌入与写入

- 批量 64–128 条，指数退避重试，限流按组织配额；
- 写库事务内：`delete from kb_chunks where document_id=$1` → 批量 insert → 更新 `kb_documents.index_status='indexed'`；
- 幂等键：`document_id + content_hash`；
- 换嵌入模型：双写（新旧 `embedding_model` 并存）→ 回填完成后切换检索条件 → 删除旧向量。

### 4.5 状态与对账

- UI 展示 `pending / indexing / indexed / failed`，失败带错误摘要；
- 每日对账任务：文件系统 `content_hash` vs `kb_documents`，修复漂移；
- 超过 10 分钟停留在 `indexing` 的记录判死并重试（最多 3 次）。

---

## 5. 检索管道

### 5.1 两阶段

```
query
  ├─ 查询改写（阶段 3 开启）：结合会话上下文补全指代
  ├─ 分支 A：向量召回 top 50   （embedding <=> $1）
  ├─ 分支 B：全文召回 top 50   （ts_rank_cd）
  ├─ RRF 融合 → 候选 50
  ├─ 重排（cross-encoder）→ top 8
  └─ 父文档回填（同一 section 合并，上限 1200 token）
```

默认参数：

```ts
const RETRIEVE = {
  vectorTopK: 50,
  fulltextTopK: 50,
  rrfK: 60,
  rerankTopN: 8,
  parentExpandMaxTokens: 1200,
  defaultK: 8,
}
```

### 5.2 RRF 融合（SQL 示意）

```sql
with vec as (
  select id, row_number() over (order by embedding <=> $1) as rn
  from kb_chunks
  where project_id = $2 and embedding_model = $3
  order by embedding <=> $1
  limit 50
),
ft as (
  select id, row_number() over (order by ts_rank_cd(tsv, q) desc) as rn
  from kb_chunks, plainto_tsquery('chinese', $4) q
  where project_id = $2 and tsv @@ q
  order by ts_rank_cd(tsv, q) desc
  limit 50
)
select id, sum(1.0 / (60 + rn)) as score
from (select * from vec union all select * from ft) u
group by id
order by score desc
limit 50;
```

### 5.3 重排

- 输入：`(query, chunk.content)`，取融合后前 50；
- 模型：`bge-reranker-v2-m3` 自托管，或 Cohere / Jina 的 rerank API；
- 输出 top 8，保留原始分数用于调试；
- 失败降级：重排超时或报错时直接用融合结果，不阻断请求。

### 5.4 返回结构

```ts
type SearchHit = {
  path: string
  sectionPath: string[]
  lines: [number, number]
  snippet: string
  score: number
  docId: string
}
```

**必须带 `path + lines`**，UI 可跳转原文，Agent 可用 `read_file` 继续读。

---

## 6. 黄金集与评测

### 6.1 黄金集 schema（JSONL）

一行一条，存 `golden/v1/dev.jsonl`、`golden/v1/test.jsonl`。

```json
{
  "id": "kb-0001",
  "split": "dev",
  "project": "loomweb",
  "query": "发布流程里 Gate 需要谁确认？",
  "query_type": "procedural",
  "difficulty": "easy",
  "expected": [
    { "file": "specs/release.md", "section": "Gate 审批", "lines": [12, 40] }
  ],
  "must_not": ["specs/legacy-release.md"],
  "answer_key": "项目负责人",
  "source": "real",
  "tags": ["gate", "release"],
  "notes": "来自 2026-10-20 的真实提问"
}
```

字段约束：

| 字段 | 取值 | 说明 |
|---|---|---|
| `query_type` | `factual` / `procedural` / `lookup` / `multihop` / `negation` / `freshness` | 用于分片统计，避免平均分掩盖短板 |
| `difficulty` | `easy` / `medium` / `hard` | hard 指需要跨文档或改写查询 |
| `expected` | ≥1 条 | 至少给出文件级；能给 section 最好 |
| `must_not` | 可选 | 明显不应召回的干扰文档（用于测精度） |
| `split` | `dev` / `test` | **test 冻结**，只在验收时跑，防止过拟合 |

标注规范：

1. 一条用例只回答一个问题；复合问题拆成多条；
2. `expected.section` 用文档里的**真实标题文本**，不要自己编；
3. 找不到答案的用 `query_type=negation`，`expected` 为空、`answer_key` 为「无」；
4. 每条注明来源（真实提问 / 人工构造），合成数据占比不超过 30%。

### 6.2 指标

**检索层**

| 指标 | 定义 |
|---|---|
| `Recall@k` | 期望文档（任一条）出现在前 k 的比例；k = 5 / 10 / 20 |
| `SectionRecall@k` | 期望 `(file, section)` 同时命中的比例 |
| `MRR@10` | 首个命中排名的倒数均值 |
| `nDCG@10` | 分级相关：精确命中 section = 2，命中同文件 = 1，否则 0 |

**回答层（可选，阶段 4 起）**

| 指标 | 方法 |
|---|---|
| 引用准确率 | 抽检 20%：返回的引用是否真的支撑结论 |
| 忠实度 | LLM Judge（固定模型 + 固定 rubric），人工抽检 10% 校准 |
| 答案正确率 | 与 `answer_key` 比对，LLM Judge + 人工复核 |

### 6.3 评测脚本

目录：

```
services/knowledge/src/eval/
├── loader.ts      读取 JSONL → Case[]
├── metrics.ts     recall / mrr / ndcg
├── runner.ts      跑指定 pipeline，产出 CaseResult[]
├── classify.ts    错误归类
├── report.ts      JSON + Markdown 报告
└── gate.ts        与基线对比，输出退出码
```

CLI：

```bash
pnpm eval \
  --golden golden/v1/dev.jsonl \
  --pipeline hybrid+rerank \
  --k 50 \
  --out reports/2026-10-23-hybrid-rerank.json
```

核心类型：

```ts
type Pipeline = 'vector' | 'hybrid' | 'hybrid+rerank'

type Case = {
  id: string
  split: 'dev' | 'test'
  project: string
  query: string
  queryType: string
  difficulty: string
  expected: { file: string; section?: string; lines?: [number, number] }[]
  mustNot: string[]
  answerKey?: string
}

type Retrieved = {
  path: string
  sectionPath: string[]
  lines: [number, number]
  score: number
  stage: 'vector' | 'fulltext' | 'fused' | 'reranked'
}

type CaseResult = {
  caseId: string
  retrieved: Retrieved[]
  hitAt: Record<5 | 10 | 20, boolean>
  sectionHitAt: Record<5 | 10 | 20, boolean>
  rank: number | null
  ndcg10: number
  errorType?: ErrorType
}
```

指标实现要点：

```ts
const hit = (r: Retrieved[], c: Case) =>
  r.some(x => c.expected.some(e => e.file === x.path))

const rankOf = (r: Retrieved[], c: Case) => {
  const i = r.findIndex(x => c.expected.some(e => e.file === x.path))
  return i === -1 ? null : i + 1
}

const mrr = (results: CaseResult[]) =>
  results.reduce((s, x) => s + (x.rank ? 1 / x.rank : 0), 0) / results.length

// nDCG@10：dcg = Σ (2^rel - 1) / log2(i + 1)，rel ∈ {0,1,2}
```

报告输出（Markdown 摘要）：

```
pipeline: hybrid+rerank    golden: v1/dev (n=86)
Recall@10      0.872   (baseline 0.743, +12.9pp)
SectionRecall@10 0.674 (baseline 0.512, +16.2pp)
MRR@10         0.702   (baseline 0.588, +11.4pp)
nDCG@10        0.741   (baseline 0.612, +12.9pp)

按 query_type 分片：
  factual     0.91 / 0.78
  procedural  0.88 / 0.71
  multihop    0.62 / 0.41   ← 短板
  negation    0.95 / —
```

### 6.4 错误自动归类

| error_type | 判定规则 | 对应修法 |
|---|---|---|
| `not_indexed` | 期望文件在 `kb_documents` 不存在或 0 chunk | 修同步/权限/解析器 |
| `parse_failure` | 文档 chunk 数明显异常（如 1 个 chunk 覆盖整篇 PDF） | 换解析器 |
| `lexical_miss` | 期望文档未进 top-50，但查询词在其 chunk 中有高覆盖 | 加权 BM25 / 加同义词 |
| `ranking` | 文档在 top-50 内但排名 > 10 | 加重排、调融合权重 |
| `boundary` | 文档命中但 section 未命中 | 调切分 / 父文档回填 |
| `absent` | 语料里确实没有 | 补文档，或标记为 negation 用例 |

每次评测输出各类占比，**按占比最大的一类去修**，避免盲目调参。

### 6.5 回归门禁

```ts
// gate.ts 伪代码
const baseline = readJson('golden/v1/baseline.json')
const fail =
  report.metrics.recall10 < baseline.recall10 - 0.01 ||
  report.metrics.ndcg10  < baseline.ndcg10  - 0.01

if (fail) {
  console.error('评测退化：拒绝合并')
  process.exit(1)
}
```

- CI 中跑 `dev` split；发版前跑 `test` split；
- 每次合并更新 `baseline.json` 只允许**提升**的方向；
- 报告归档到 `reports/`，保留 90 天。

### 6.6 线上信号回流

从 `retrieval_logs` 每周抽样：

- `result_count = 0` → 候选新用例（缺失或词表问题）；
- 同会话 `reformulated = true` → 首次检索失败，人工判断是否入集；
- `clicked_path` 与召回首位不一致 → 排序问题样本；
- 人工确认后加入 `dev`，**不进 `test`**（保持冻结）。

---

## 7. 中文检索

Postgres 默认分词对中文无效，而混合检索（杠杆 2）正是效果提升最大的一环，必须解决。

| 方案 | 做法 | 取舍 |
|---|---|---|
| **zhparser**（推荐起步） | 安装 `zhparser` 扩展 + 创建 `chinese` 文本搜索配置 | 纯 Postgres，够用 |
| **pg_jieba** | 中文分词扩展，配合 `tsvector` | 效果相近，社区较小 |
| **ParadeDB pg_search** | 真正的 BM25（Tantivy）+ jieba tokenizer | 更准，多一个扩展/镜像 |
| **外部引擎** | Meilisearch / OpenSearch | 最灵活，但多一套运维 |

v1 用 zhparser；若评测显示 `lexical_miss` 占比仍高，再评估 ParadeDB。

注意：`tsvector` 生成列在扩展版本升级后需要 `REINDEX`，迁移脚本里显式处理。

---

## 8. Agent 工具接口

```ts
// MCP tool: search_knowledge
{
  name: 'search_knowledge',
  input: {
    query: string,
    folder?: string,
    kind?: 'markdown' | 'code' | 'pdf',
    updatedAfter?: string,
    k?: number            // 默认 8，上限 20
  },
  output: {
    results: {
      path: string,
      sectionPath: string[],
      lines: [number, number],
      snippet: string,
      score: number
    }[]
  }
}

// MCP tool: read_file
{ input: { path: string, startLine?: number, endLine?: number },
  output: { content: string, truncated: boolean } }

// MCP tool: list_specs
{ input: {}, output: { path: string, enabledInPrompt: boolean }[] }
```

约束：

1. **强制按项目隔离**，项目 ID 来自会话上下文，不接受模型传入；
2. `k` 上限 20，防止一次塞爆上下文；
3. 返回必须是引用形态（路径 + 行号），不做无出处的摘要；
4. 所有调用写 `retrieval_logs`，用于评测回流；
5. 检索失败时返回空数组 + `hint`，让 Agent 改用 `list_files` 或直接读目录，而不是让它编造。

**定位说明**：Agent 的 workspace 里本来就有文件，`read_file` / `grep` 往往比检索更准。`search_knowledge` 的价值是「大语料里快速定位 + 给出可信引用」，必须允许**多轮调用与查询改写**，而不是会话开始注入一次。

---

## 9. 基线管道（v0）

**v0 的目的不是好效果，而是让效果可度量。** 必须在做任何调优前完成。

范围（刻意最小）：

| 项 | v0 实现 |
|---|---|
| 文件类型 | markdown + text + code（不含 PDF） |
| 解析 | markdown 按标题、代码按行窗口（先不接 tree-sitter） |
| 切分 | 固定 500 token / 60 重叠 |
| 嵌入 | 单个 API 模型，1024 维 |
| 存储 | pgvector，HNSW |
| 检索 | **纯向量 top 10**，按项目过滤 |
| 重排 | 无 |
| 评测 | 50 条黄金集 + Recall@k / MRR / nDCG |
| UI | 无，只有内部检索接口 |

完成标准：

1. 任意一个项目目录能在 5 分钟内完成全量索引；
2. 给定查询能返回带 `path + lines` 的前 10 条；
3. `pnpm eval` 能产出基线数字并归档；
4. 有一条端到端的自动化测试（造 3 个文档 → 索引 → 查询 → 命中）。

拿到基线后再按 §6.4 的错误分布决定下一项投入，**不要一次把六个杠杆全加上**。

---

## 10. 实施任务拆解（2 周）

| 天 | 任务 | 产出 |
|---|---|---|
| D1 | 建表与迁移、项目隔离校验 | `kb_documents` / `kb_chunks` |
| D2 | markdown/text/code 解析 + 切分 + 幂等 | Ingestion 单测 |
| D3 | 嵌入批处理 + upsert + 状态机 | 可索引一个真实项目 |
| D4 | 向量检索 + `search_knowledge` 工具 | 端到端可查 |
| D5 | **黄金集 50 条 + 评测脚本 + 基线报告** | `golden/v1/` + 基线数字 |
| D6 | zhparser + 全文召回 + RRF 融合 | `hybrid` pipeline |
| D7 | 重排接入 + 父文档回填 | `hybrid+rerank` pipeline |
| D8 | 错误自动归类 + 回归门禁 + 首轮调优 | CI 接入 |
| D9 | 监控（索引延迟/失败率/空结果率）+ 对账任务 | 告警规则 |
| D10 | 黄金集扩充到 80+、验收、补齐文档 | 验收报告 |

并行项（不占本排期）：知识库前端面板、上传与目录树。

---

## 11. 验收标准

| 项 | 目标（基线校准后定稿） |
|---|---|
| 黄金集规模 | ≥ 80 条，覆盖 6 类 `query_type`，合成数据 ≤ 30% |
| `Recall@10`（文档级） | ≥ 0.85 |
| `SectionRecall@10` | ≥ 0.65 |
| `nDCG@10` | ≥ 0.70 |
| 引用准确率（抽检 20%） | ≥ 0.90 |
| 索引延迟 | 单文档 P95 < 10s；100 文档批量 < 5min |
| 索引失败率 | < 1%，且失败可见可重试 |
| 回归门禁 | CI 生效，退化即失败 |
| 文档漂移 | 每日对账后不一致文档数 = 0 |

> 目标值是起点，**以基线实测为准校准**；首次跑完基线后在本节回填实际数字与调整后的目标。

---

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| 黄金集只覆盖已知问题，指标虚高 | 线上信号持续回流；`test` split 冻结；定期盲测 |
| 中文分词扩展安装/版本问题 | 迁移脚本固化扩展版本；CI 镜像预装；`REINDEX` 纳入升级流程 |
| 嵌入 API 限流或抖动 | 批量 + 指数退避 + 死信队列；失败不丢任务 |
| 索引与文件系统漂移 | `content_hash` + 每日对账 + 手动重建入口 |
| 评测过拟合 | dev/test 分离；调参只允许看 dev |
| 重排增加延迟 | 超时降级到融合结果；必要时只对 top 20 重排 |
| 换嵌入模型导致全量重嵌 | `embedding_model` 列 + 双写 + 灰度切换 |
| 检索结果塞爆 Agent 上下文 | `k` 上限 + 父文档回填上限 + 返回片段而非全文 |

---

## 13. 与总体方案的衔接

- 本文落实总体方案 §5.1–§5.6；
- P5「记忆与反思」复用本文的嵌入、去重与评测基础设施；
- 知识库前端 UI 在 P3 并行开发，接口按 §8 的返回结构设计；
- 管理员「模型配置」中的嵌入模型白名单决定 `embedding_model` 取值，切换需走 §4.4 的双写流程。
