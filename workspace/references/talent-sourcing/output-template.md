# Output Template

按下面格式输出，优先保证结构清晰，不追求长。

## 1. 反向调研摘要

- 业务语境：
- 真正要解决的问题：
- 最贴合的 3 类人：
- 最容易误召回的 3 类人：
- 判断依据：

## 2. 候选人画像卡

```yaml
persona_name: ""
must_have: []
strong_signal: []
evidence_signal: []
negative_signal: []
target_companies: []
target_titles: []
```

## 3. 搜索轮次矩阵

```json
[
  {
    "round_name": "",
    "goal": "",
    "companies": [],
    "titles": [],
    "keywords": [],
    "filters": {
      "city": "",
      "experience": "",
      "education": "",
      "school": ""
    },
    "why_this_round": "",
    "stop_rule": ""
  }
]
```

## 4. 渠道投喂

- 脉脉：
- BOSS：
- LinkedIn：

## 5. 候选结果集（如果已经开始列人）

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

## 6. 下一步建议

- 继续执行哪个渠道
- 哪些条件先不放宽
- 如果结果少，先放宽哪一层
