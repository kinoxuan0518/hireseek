# HireClaw 使用手册

## 第一次使用

1. 在 [console.anthropic.com](https://console.anthropic.com) 获取 API Key
2. 填写 `.env`：
   ```
   LLM_PROVIDER=claude
   LLM_MODEL=claude-sonnet-4-5
   ANTHROPIC_API_KEY=sk-ant-你的key
   ```
3. 编辑 `workspace/jobs/active.yaml`，填写你要招的职位
4. 在 BOSS直聘企业端登录好账号
5. 运行 `npx tsx src/index.ts chat` 开始对话

---

## 每日工作流

### 早上（10 分钟）
```bash
npx tsx src/index.ts run
```
它自动去 BOSS、脉脉等渠道 sourcing，你去做别的事。

### 下午（2 分钟）
```bash
npx tsx src/index.ts scan
```
扫描收件箱，自动标记谁回复了。

### 随时：有候选人进展
```bash
npx tsx src/index.ts update 张三 interviewed
npx tsx src/index.ts update 张三 joined
```

### 随时：想聊聊招聘
```bash
npx tsx src/index.ts chat
```
直接跟它说话——问候选人怎么样、让它搜公司背景、讨论话术、让它去跑任务。

### 每周一次：看漏斗
```bash
npx tsx src/index.ts funnel
```

---

## 全部命令

| 命令 | 做什么 |
|------|--------|
| `chat` | 对话模式，能聊能执行 |
| `run` | 自主 sourcing（按 active.yaml 决定渠道）|
| `run boss` | 只跑 BOSS直聘 |
| `scan` | 扫描收件箱，更新回复状态 |
| `update 张三 replied` | 手动更新候选人状态 |
| `funnel` | 查看招聘漏斗数据 |
| `start` | 启动定时守护进程 |

---

## 候选人状态说明

| 状态 | 含义 |
|------|------|
| `contacted` | 已打招呼 |
| `replied` | 对方回复了 |
| `interviewed` | 已面试 |
| `offered` | 已发 Offer |
| `joined` | 已入职 |
| `rejected` | 已淘汰 |
| `dropped` | 放弃跟进 |

---

## 换职位招聘

编辑 `workspace/jobs/active.yaml`，改 `title` 和 `requirements`，下次跑自动切换。

---

## 它学不好时怎么办

跟它说就行：

```
npx tsx src/index.ts chat

你: 最近 BOSS 的话术效果很差，我觉得太官方了
HireClaw: [分析问题，提出改进方向，问你确认后更新策略]
```

它会自己改 outreach-guide.md，下次执行用新策略。

---

## 它不知道的事，怎么教它

打开 `workspace/references/founders-wisdom.md`，直接加进去。
或者在 chat 模式里跟它说，让它自己记录。
