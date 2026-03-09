# Cache Schema Reference

HireClaw 使用本地 JSON 文件缓存职位配置与触达历史，避免每次运行重复解析，支持增量更新。

---

## 目录结构

```
~/.hireclaw/
├── hireclaw.db                    # SQLite 主数据库（任务记录、候选人）
├── bosszhibin_cache/
│   ├── bosszhibin_jobs_cache.json # BOSS 职位配置缓存
│   └── evolution_history.json     # 执行历史与复盘记录
└── maimai_cache/
    ├── job_configs.json           # 脉脉岗位配置与搜索矩阵
    └── outreach_history.json      # 脉脉触达历史
```

> 路径可通过 `.env` 中 `BOSSZHIBIN_CACHE_DIR` / `MAIMAI_CACHE_DIR` 自定义。

---

## BOSS 直聘：bosszhibin_jobs_cache.json

```json
{
  "schema_version": "7.3",
  "updated_at": "2026-01-01T09:00:00Z",
  "global_rule_defaults": {
    "experience_policy": {
      "required_range": [1, 5],
      "campus_exception_enabled": true
    },
    "school_policy": {
      "bachelor_only": true,
      "required_tiers": ["985", "QS100"]
    },
    "ai_skill_policy": {
      "ai_skill_required": false,
      "keywords": [],
      "match_mode": "any"
    },
    "ui_prefilter_policy": {
      "enabled": true,
      "clear_last_filter_first": true,
      "experience_primary": ["1-3年", "3-5年"],
      "school_tags": ["985", "国内外名校"],
      "education_tags": ["本科", "硕士"],
      "max_keyword_tags": 4,
      "recent_unviewed": "近14天没有"
    },
    "integration_policy": {
      "feishu_bitable": { "enabled": false }
    }
  },
  "jobs": [
    {
      "job_id": "string, 职位唯一 ID（从平台读取或自定义）",
      "job_name": "string, 职位名称",
      "priority": "high | medium | low",
      "rule_overrides": {
        "school_policy": { "required_tiers": ["985"] },
        "ai_skill_policy": { "ai_skill_required": true, "keywords": ["关键词"] },
        "ui_prefilter_policy": { "keyword_tags": ["平台关键词"] }
      },
      "stats": {
        "total_contacted": 0,
        "total_skipped": 0,
        "last_processed": null
      }
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `schema_version` | string | 缓存格式版本，低版本自动迁移 |
| `global_rule_defaults` | object | 所有职位的默认规则，职位可覆盖 |
| `jobs[].rule_overrides` | object | 仅存与全局不同的差异项（深度合并） |
| `jobs[].stats` | object | 执行统计，每次任务后自动更新 |

---

## 脉脉：job_configs.json

```json
{
  "schema_version": "1.0",
  "updated_at": "2026-01-01T10:00:00Z",
  "jobs": [
    {
      "job_id": "string",
      "job_name": "string",
      "city": "北京",
      "education": "本科",
      "experience_range": [1, 5],
      "school_tiers": ["985", "QS100"],
      "search_rounds": [
        {
          "round_id": "r1",
          "keywords": ["关键词A", "关键词B"],
          "company_filter": "大厂",
          "description": "轮次说明"
        }
      ],
      "stats": {
        "total_contacted": 0,
        "last_processed": null
      }
    }
  ]
}
```

---

## 脉脉：outreach_history.json

```json
{
  "schema_version": "1.0",
  "records": [
    {
      "candidate_fingerprint": "name|company|school",
      "job_id": "string",
      "contacted_at": "2026-01-01T10:30:00Z",
      "round_id": "r1",
      "score": 82,
      "message_preview": "消息前20字"
    }
  ],
  "daily_stats": {
    "2026-01-01": { "contacted": 15, "skipped": 30 }
  }
}
```

---

## BOSS 直聘：evolution_history.json

```json
{
  "schema_version": "1.0",
  "runs": [
    {
      "run_id": "string",
      "executed_at": "2026-01-01T09:00:00Z",
      "job_id": "string",
      "contacted": 10,
      "skipped": 25,
      "score_distribution": { "90+": 2, "80-89": 5, "70-79": 3 },
      "anomalies": [],
      "reflection": "复盘摘要文字"
    }
  ]
}
```
