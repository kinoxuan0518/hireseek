# 🦞 HireClaw

**Autonomous recruiting agent for BOSS直聘, 脉脉, and LinkedIn.**

HireClaw is an AI-powered recruiting automation tool. It controls a browser like a human recruiter — searching candidates, applying filters, scoring profiles, and sending personalized outreach messages. All driven by an LLM of your choice.

---

## Features

- **Multi-channel**: BOSS直聘 / 脉脉 / LinkedIn / 跟进未回复
- **Multi-LLM**: Claude, OpenAI, MiniMax, or any OpenAI-compatible API
- **Smart filtering**: Two-layer screening (platform filters + script-level scoring)
- **Cache-based config**: Job preferences cached locally, no repeated setup
- **Auto follow-up**: Tracks unreplied candidates and re-engages with fresh messages
- **Feishu reporting**: Daily sourcing reports pushed to your Feishu group (optional)
- **Scheduled daemon**: Runs automatically on weekdays via cron

---

## Quick Start

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your LLM API key:

```env
# Choose your LLM provider
LLM_PROVIDER=claude   # claude | openai | minimax | custom

# Fill in the key for your chosen provider
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# MINIMAX_API_KEY=...
```

### 3. Run

```bash
# Trigger BOSS直聘 sourcing once
npm run dev run boss

# Trigger 脉脉 sourcing once
npm run dev run maimai

# Follow up unreplied candidates
npm run dev run followup

# Start the daemon (runs on schedule)
npm run dev start
```

---

## Supported LLM Providers

| Provider | Model | Computer-Use |
|----------|-------|-------------|
| Claude (Anthropic) | claude-opus-4-6 | ✅ Native |
| OpenAI | computer-use-preview | ✅ Native |
| MiniMax | abab6.5s-chat / MiniMax-Text-01 | ⚡ via function calling |
| Custom (any OpenAI-compatible) | your model | ⚡ via function calling |

> Native computer-use (Claude/OpenAI) gives the best results. Generic providers use function calling to simulate browser control.

---

## Configuration

### Job Configuration

On first run, HireClaw will prompt you to configure your job requirements interactively. Configuration is cached at `~/.hireclaw/bosszhibin_cache/bosszhibin_jobs_cache.json`.

Key settings per job:
- School tier requirements (985 / QS100 / 211 / any)
- Company background requirements
- Required skills / keywords
- Experience range
- Score threshold for outreach

### Schedule (daemon mode)

Default schedule in `.env`:

```env
SCHEDULE_BOSS=0 9 * * 1-5      # Weekdays 9:00 AM
SCHEDULE_MAIMAI=0 10 * * 1-5   # Weekdays 10:00 AM
SCHEDULE_FOLLOWUP=0 14 * * 1-5 # Weekdays 2:00 PM
```

### Feishu Notifications (optional)

```env
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
```

---

## Project Structure

```
hireclaw/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── orchestrator.ts   # Channel coordinator
│   ├── scheduler.ts      # Cron daemon
│   ├── browser-runner.ts # Playwright browser control
│   ├── config.ts         # Environment config
│   ├── db.ts             # SQLite database
│   ├── types.ts          # TypeScript types
│   ├── runners/          # LLM provider implementations
│   │   ├── claude.ts
│   │   ├── openai.ts
│   │   ├── generic-vision.ts
│   │   └── index.ts
│   ├── skills/
│   │   └── loader.ts     # Skill file loader
│   └── channels/
│       └── feishu.ts     # Feishu webhook
└── workspace/
    ├── SOUL.md           # Agent personality & philosophy
    ├── HEARTBEAT.md      # Schedule definition
    ├── skills/           # Per-channel skill prompts
    │   ├── boss.md
    │   ├── maimai.md
    │   ├── linkedin.md
    │   └── followup.md
    └── references/       # Supporting documentation
        ├── cache-schema.md
        ├── search-playbook.md
        ├── outreach-playbook.md
        └── platform-ui-reference.md
```

---

## How It Works

1. **Browser opens** — Playwright launches Chromium and navigates to the recruiting platform
2. **Screenshot taken** — Current page state captured as image
3. **LLM decides** — The model sees the screenshot and decides the next action (click, type, scroll)
4. **Action executed** — Playwright performs the action
5. **Loop** — Steps 2-4 repeat until the task is complete
6. **Report generated** — Summary sent to terminal and optionally to Feishu

---

## Workspace Conventions

HireClaw uses workspace files inspired by agent OS conventions:

- `SOUL.md` — Core identity and recruiting philosophy
- `HEARTBEAT.md` — Scheduled tasks definition
- `skills/*.md` — Executable skill prompts per channel
- `references/*.md` — Reference documentation for skills

---

## Requirements

- Node.js 22+
- macOS / Linux
- An API key for at least one supported LLM provider
- Accounts logged into your target recruiting platforms

---

## Limitations

- Cannot bypass daily outreach limits imposed by platforms
- Cannot auto-reply to incoming candidate messages
- Requires human final decision on offers and interviews
- LLM vision quality affects automation reliability

---

## License

MIT
