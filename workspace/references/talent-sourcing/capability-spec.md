# Talent-Sourcing Capability Spec

## 1. 定位

`talent-sourcing` 是 Hireclaw 的人才情报与寻源能力模块。

它负责：

- 澄清“要找什么样的人”
- 生成可执行的寻源策略
- 做冰山以下人才挖掘
- 做指定人物或指定群体调研
- 给下游渠道 skill 或 Hireclaw 总控输出结构化输入

它不负责：

- 最终触达执行
- 跟进回复
- 漏斗推进
- ATS / CRM 全流程管理
- 单渠道页面自动化

## 2. 任务类型

### 2.1 `role_sourcing`

- 标准岗位招聘
- 需要定义画像并进入招聘渠道执行

### 2.2 `hidden_talent_discovery`

- 冰山以下人才挖掘
- 平台上不一定活跃的人
- 研究型、开源型、项目型人才发现

### 2.3 `person_research`

- 研究某个具体人值不值得挖
- 判断这个人是否真的符合目标方向

### 2.4 `group_mapping`

- 找“Peak 这种人”
- 找某个团队/实验室/公司类型里的一群人

### 2.5 `builder_mapping`

- 找 `Cat Wu / Peak Ji / Peter Steinberger` 这类 builder-operator
- 找 AI-native product builder、agent product builder、developer-tool founder turned AI builder

## 3. 输入 Schema

最小输入字段：

- `task_type`
- `role_or_target`
- `business_context`
- `hard_constraints`
- `soft_preferences`
- `execution_intent`

推荐补充字段：

- `location_preferences`
- `company_preferences`
- `school_preferences`
- `known_examples`
- `known_non_examples`
- `priority_signals`

## 4. 输出 Schema

### 4.1 `research_summary`

- 这类人为什么值得找
- 高噪声误召回有哪些
- 最适合的来源是什么

### 4.2 `persona`

- `must_have`
- `strong_signal`
- `negative_signal`
- `evidence_signal`
- `discovery_signal`
- `verification_questions`
- `archetype_definition`

### 4.3 `strategy`

- `target_companies`
- `target_titles`
- `keywords_cn`
- `keywords_en`
- `negative_keywords`
- `recommended_sources`

### 4.4 `execution_payload`

- 给脉脉：`search_rounds_json`
- 给 LinkedIn：title + keyword + verification focus
- 给人工研究：query plan
- 给 Hireclaw：结构化任务描述

### 4.5 `candidate_result_set`

- `name`
- `current_role`
- `current_company`
- `location`
- `archetype_fit`
- `ai_focus`
- `builder_type`
- `evidence_summary`
- `evidence_sources`
- `why_match`
- `reachability`
- `suggested_channel`
- `priority`
- `confidence`

### 4.6 `confidence_and_evidence`

- 哪些是硬证据
- 哪些是推断
- 哪些还需要验证

## 5. Source 范围

第一版支持：

- LinkedIn
- GitHub
- Google Scholar
- arXiv
- Hugging Face
- 脉脉
- 飞书历史招聘数据
- 公司 team page / 产品发布页 / 个人博客与访谈页

## 6. Source 选择逻辑

### 6.1 `role_sourcing`

- 主 source：脉脉、LinkedIn
- 辅助验证：GitHub、Scholar / arXiv、Hugging Face

### 6.2 `hidden_talent_discovery`

- 主 source：GitHub、Scholar、arXiv、Hugging Face、个人主页 / 项目页 / 团队页

### 6.3 `person_research`

- 主 source：LinkedIn、GitHub、Scholar / arXiv、网页交叉验证

### 6.4 `group_mapping`

- 主 source：公司团队页、实验室主页、项目 contributors、LinkedIn / GitHub

### 6.5 `builder_mapping`

- 主 source：LinkedIn、GitHub、公司 / 产品 team page、产品发布页、个人博客 / 访谈 / conference page

## 7. 质量标准

- 不能只靠 title 判断
- 不能只给关键词不给排除词
- 不能把“在某公司”直接等同于“做过该方向”
- 必须尽量区分硬证据和推断
- 必须给出下一步建议，而不是只输出名单
- 如果输入是样本人物，必须先抽 archetype，再做扩展搜索

## 8. 与 Hireclaw 的关系

- Hireclaw 负责总控编排与上下文理解
- `talent-sourcing` 负责“找什么人、怎么找”
- 渠道 skill 负责“去哪里执行、如何触达”

