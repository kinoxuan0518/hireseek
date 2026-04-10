---
name: talent-sourcing
description: >
  人才寻源策略技能：把模糊招聘需求拆成可执行的人才画像、反向调研结论、目标公司池、
  关键词矩阵与渠道搜索轮次。用于“帮我找做某方向的人”“为这个岗位设计找人策略”
  “把 JD 变成脉脉/BOSS/LinkedIn 搜索方案”“先反向调研再找候选人”
  “挖掘冰山以下人才”“调研某个优秀人才是否值得触达”等场景。
---

# 人才寻源策略协议

版本：1.0
语言：中文
定位：Hireclaw 的人才情报与寻源能力模块，不直接触达候选人

## 0. 适用边界

- 本 skill 负责把自然语言需求转成可执行的 sourcing 方案。
- 本 skill 默认先做“反向调研”，再做画像拆解和轮次设计。
- 本 skill 是 Hireclaw 的一个能力模块，不是独立的招聘总控产品。
- 本 skill 是“全局寻源模式”的主控 skill：当用户在问“要找什么样的人”“该怎么找”“哪些渠道更合适”时，默认先触发本 skill。
- 在中国招聘市场里，脉脉通常是默认渠道之一；因此本 skill 输出的渠道建议里可以默认包含脉脉，但这不等于立即进入脉脉执行模式。
- 当下游是 `maimai-recruiter` 时，本 skill 应被视为其上游策略层；脉脉执行前如缺少有效策略，必须先调用本 skill。
- 本 skill 不直接发消息，不替代 `maimai-recruiter`、`boss-recruiter`、`linkedin-recruiter` 等执行层 skill。
- 如果用户只想“先看看画像/公司池是否合理”，停在策略输出；如果用户要求继续执行，再把结果交给下游 skill。

### 0.1 两种模式区分

- 全局寻源模式：
  - 用户意图是“要找什么样的人 / 用哪些渠道找 / 先做寻源决策”
  - 默认由 `talent-sourcing` 主控
  - 输出可以包含脉脉、BOSS、LinkedIn 等渠道建议
- 渠道执行模式：
  - 用户意图是“现在就去某个渠道执行搜索和触达”
  - 渠道 skill 主控；若缺策略，再回调 `talent-sourcing`

### 0.2 在 Hireclaw 中的职责

- 和用户共创岗位画像，澄清“到底找什么人”。
- 根据画像判断应该走：
  - 常规招聘渠道找人
  - 冰山以下人才挖掘
  - 指定人物/指定群体调研
- 输出可直接交给下游 skill 或数据层的结构化结果。
- 不负责最终触达、跟进、推进招聘漏斗。

## 1. 输入理解

先抽取以下字段；缺失时做合理假设并在输出中写明：

- 目标岗位：如 `AI研究员`、`大模型算法工程师`
- 技术主题：如 `RLHF`、`Agent`、`多智能体`
- 硬门槛：年限、学校、本科层级、城市、语言、行业经历
- 软偏好：是否偏研究、偏系统、偏产品化、偏 ToB
- 招聘主体与业务语境：如 `黑湖科技 / 制造业 / 工业 SaaS / Agent 决策`
- 任务类型：
  - 常规渠道寻人
  - 冰山以下挖掘
  - 指定人物调研
  - 指定群体映射
  - Builder / Operator 型人才映射

如果用户需求明显模糊，不要直接泛搜“AI人才”；必须进入第 2 步反向调研。

## 1.1 默认 source 范围

第一版优先使用少数高价值 source，不追求全网铺开：

- LinkedIn：全球职业身份主源
- GitHub：开源与工程证据
- Google Scholar / arXiv：研究与论文证据
- Hugging Face：模型、数据集、benchmark 证据
- 脉脉：中文圈职业身份与后续执行主渠道之一
- 飞书历史招聘数据：内部反馈与去重参考

按任务类型选择 source：

- 常规渠道寻人：脉脉、LinkedIn、BOSS/其他招聘渠道
- 冰山以下挖掘：GitHub、Scholar、arXiv、Hugging Face、个人主页、项目页
- 指定人物调研：LinkedIn + GitHub + Scholar + 公开网页交叉验证
- Builder / Operator 型人才映射：LinkedIn、GitHub、公司/team page、产品发布页、个人博客/访谈页

## 2. 反向调研

这是默认必做步骤。目标不是“找人”，而是先回答“什么样的人最可能真的适合这个岗位”。

按顺序完成：

1. 读取用户公司/岗位的业务背景，提炼真实工作场景。
2. 判断该岗位更像哪类人才组合：
   - 研究型：偏算法、论文、训练与评测
   - 系统型：偏 Agent workflow、tool use、推理链路、评测与工程
   - 应用型：偏 ToB 落地、行业场景、产品闭环
   - 混合型：研究深度 + 工程落地
3. 反推出最值得找的背景信号：
   - 目标公司类型
   - 典型职位头衔
   - 必要技术关键词
   - 可验证成果信号
   - 最适合切入的 source
4. 明确“伪匹配人群”并提前排除。

默认输出一个《反向调研摘要》，至少包含：

- 为什么这个岗位不能只搜通用 `算法工程师`
- 哪 3 类背景最贴合
- 哪 3 类高噪声人群最容易误召回
- 为什么这些判断成立

公司和方向线索优先查看：

- `references/talent-sourcing/company-map.md`
- `references/talent-sourcing/keyword-map.md`

## 3. 人才画像拆解

把需求拆成 5 层：

1. `must_have`
   - 不满足就不继续搜
2. `strong_signal`
   - 强相关但可放宽
3. `evidence_signal`
   - 用于验证不是“标题党”
4. `negative_signal`
   - 明确排除的人群
5. `channel_fit`
   - 更适合在哪个渠道找

输出时用结构化字段，而不是散文描述。

补充：

- 若是“冰山以下人才挖掘”，必须单列 `discovery_signal`
- 若是“指定人物调研”，必须单列 `verification_questions`
- 若是“找 Peak 这种人 / 找 Cat Wu 这种人 / 找 Peter Steinberger 这种人”，必须单列 `archetype_definition`

### 3.1 Builder-Operator Archetype

当用户给出的样本更像 `Cat Wu / Peak Ji / Peter Steinberger` 这类“作品导向型 AI builder”时，默认按以下 archetype 处理：

- `must_have`
  - 对 AI / agent / developer tools / workflow 有真实产品或平台贡献
  - 兼具技术理解与产品化判断，而不是纯研究或纯项目管理
  - 有可公开验证的作品、发布、团队角色或项目证据
- `strong_signal`
  - 担任 founder、chief scientist、产品负责人、技术负责人、核心 builder
  - 与 coding agent、AI workflow、agent infra、developer platform、AI-native product 强相关
  - 能把新技术范式快速转成用户可用产品
- `evidence_signal`
  - 产品官网/team page
  - GitHub repo / contributor 记录
  - 发布文章、技术博客、访谈、公开演讲
  - 招聘/媒体/官网中可验证的团队职责描述
- `negative_signal`
  - 只有大厂/独角兽 title，没有作品证据
  - 纯研究作者，没有明显产品化或系统落地信号
  - 纯运营/市场/普通产品经理，不具备 AI-native builder 特征
  - 纯应用包装，没有系统层、平台层或开发者产品痕迹

## 4. 搜索策略生成

基于画像生成“递进式轮次矩阵”，禁止重复、平铺式撒网。

每轮至少写清：

- `round_name`
- `goal`
- `companies`
- `titles`
- `keywords`
- `filters`
- `why_this_round`
- `stop_rule`
- `sources`

若任务是 `Builder / Operator 型人才映射`，优先输出：

- `archetype_definition`
- `seed_people`
- `target_companies_or_projects`
- `public_product_signals`
- `builder_queries`
- `reachable_paths`

## 5. 结果包装

优先产出以下 5 个块：

### 5.1 反向调研摘要

- 业务问题
- 目标人群
- 噪声人群
- 结论依据

### 5.2 候选人画像卡

```yaml
persona_name:
must_have:
strong_signal:
evidence_signal:
negative_signal:
target_companies:
target_titles:
```

### 5.3 搜索轮次矩阵

```json
[
  {
    "round_name": "",
    "goal": "",
    "companies": [],
    "titles": [],
    "keywords": [],
    "sources": [],
    "filters": {},
    "why_this_round": "",
    "stop_rule": ""
  }
]
```

### 5.4 渠道投喂建议

- `maimai-recruiter`：给中文关键词、公司桶、城市/年限/学校过滤
- `boss-recruiter`：给硬门槛、目标公司清单、排除项
- `linkedin-recruiter`：给英文 title、英文关键词、研究/开源验证信号

### 5.5 候选结果集 Schema

```json
[
  {
    "name": "",
    "current_role": "",
    "current_company": "",
    "location": "",
    "archetype_fit": "",
    "ai_focus": "",
    "builder_type": "",
    "evidence_summary": "",
    "evidence_sources": [],
    "why_match": "",
    "reachability": "",
    "suggested_channel": "",
    "priority": "",
    "confidence": ""
  }
]
```

## 6. 质量门槛

- 不能把“泛 AI 公司 + 泛算法 title”伪装成精准策略。
- 不能只给关键词，不给负向排除词。
- 不得把“在某公司任职”自动等同于“做过该方向”；必须尽可能给出方向证据。
- 如果用户给的是样本人物而不是标准岗位，必须先提炼共同 archetype，再扩展相似人选。
- 如果已经输出候选人名单，必须尽量结构化为可筛选结果集，至少给出 `why_match` 和 `evidence_summary`。

## 7. 默认工作流

1. 读取需求并抽取硬条件。
2. 做反向调研，先判断“该找什么背景的人”。
3. 生成结构化人才画像。
4. 判断这是：
   - 常规渠道寻人
   - 冰山以下挖掘
   - 指定人物调研
   - Builder / Operator 型人才映射
5. 生成对应的搜索/调研策略。
6. 若已开始列人，输出统一候选结果集 schema。
7. 给出渠道投喂格式或调研验证格式。
8. 若用户要求继续执行，再调用对应招聘执行 skill 或交给 Hireclaw 后续编排。

