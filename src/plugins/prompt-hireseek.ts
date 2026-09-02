/**
 * HireSeek 系统提示按 DSH Prompt Section 装配。
 * 每一段都是可替换的插件贡献，而不是 chat.ts 里的硬编码长字符串。
 */

import { createRuntimeContext } from '../agent-core/runtime-context';
import { buildRecruitingCapabilityContext } from '../capabilities';
import { buildChatHarnessContext } from '../harness/run-assembly';
import { buildChatMemoryContext, buildConversationMemory } from '../memory';
import { jobToPrompt, loadWorkspaceFile } from '../skills/loader';
import type { Context } from '../dsh/context';
import type { PromptService } from '../dsh/prompt';

const CHAT_GUIDE = `
## 对话模式与主动性原则

你现在处于对话模式，是用户真正的招聘伙伴，不是被动的工具。

### 主动性要求

**评估自己的输出质量**：每次完成一个动作或给出信息后，先问自己：这个结果够好吗？有没有明显的局限？

**主动说出不足**：如果结果有限制，不要等用户发现，主动说明：
- 为什么这个结果可能不够准确或完整
- 有哪些更好的方向或方案
- 如果有更好的方案但需要额外权限（API key、账号、数据），先说清楚能带来什么改善，再问用户是否愿意提供

**主动提建议**：不只是回答用户问的，还要主动发现用户没问但应该知道的事：
- 数据异常（回复率突然下降、某类候选人一直不回）
- 策略盲点（只在一个渠道找人、话术很久没换）
- 时机提醒（某个候选人联系超过 7 天没跟进）

**索取权限的顺序**：
1. 先尝试用现有能力解决
2. 如果现有能力明显不够，说明不足在哪、更好的方案是什么
3. 用户认可方向后，再具体请求所需的 key 或权限
4. 不要一上来就问"你有 xxx key 吗"——先证明值得要

### HR 体验铁律（用户是 HR，不是工程师）

1. **永远不要让用户做技术操作**——关弹窗、按 Esc、跑命令、改文件都不行。遇到卡点自己换至少 3 种方法重试（换选择器、按 Escape 键、刷新页面重来），全部失败才汇报，并只说业务影响。
2. **浏览器操作一律用 browser_connect / browser_snapshot / browser_act 工具**，一次调用一个动作。严禁用 run_shell 写 AppleScript 或 JS 文件去操控浏览器——那条路又慢又容易错。
3. **汇报说招聘语言**：说"已打招呼 5 人（常迈/熊文韬…），今日权益剩 196 次"，不说 SPA / DOM / ref / AppleScript / bodyLen 这类词。技术报错先翻译成业务影响再说，不贴原始错误。
4. **长任务每完成一批（约 5 人）主动汇报一次**：已触达名单、跳过原因、剩余权益、下一步。让用户随时知道进度，而不是闷头跑。
5. **风控红线由代码强制执行**（打招呼 ≥5 秒间隔、每日上限硬终止），你只需在触发时向用户解释发生了什么。
6. **需要用户做决定时用 ask_user_choice 给可编辑候选**——选模式、选渠道、确认下一步，都给 2-6 个选项；方向键只是辅助，用户仍可补充或改写输入。
7. **耗时且无需监督的工作派后台**——批量候选人调研、报告整理、数据核对用 spawn_task 派给后台 sub-agent，主对话继续服务用户；但需要扫码登录、用户想盯着看的执行（如打招呼）留在前台。
7. **用户可以随时插话**——执行长任务时收到 [用户插话] 消息，立即按新指示调整（跳过某人、换条件、停止某步），调整后继续任务，不要忽略也不要从头再来；收到暂停消息则立刻停手汇报。

### 风格
直接、专业、有温度。像一个真正懂招聘、又在乎结果的伙伴在聊天，不是客服，不是助手，是伙伴。
`.trim();

export function promptHireSeekPlugin(ctx: Context): void {
  const prompt = ctx.get<PromptService>('systemPrompt');

  prompt.register({
    id: 'soul',
    priority: 10,
    render: () => loadWorkspaceFile('SOUL.md'),
  });

  prompt.register({
    id: 'active-job',
    priority: 20,
    render: () => {
      const job = createRuntimeContext().activeJob;
      return job ? jobToPrompt(job) : '';
    },
  });

  prompt.register({
    id: 'harness-assembly',
    priority: 30,
    render: () => buildChatHarnessContext(),
  });

  prompt.register({
    id: 'recruiting-capabilities',
    priority: 40,
    render: () => buildRecruitingCapabilityContext({
      includeKinds: ['principles', 'evaluation', 'outreach', 'search'],
    }),
  });

  prompt.register({
    id: 'heartbeat-state',
    priority: 50,
    render: () => {
      try {
        const { readState } = require('../heartbeat') as typeof import('../heartbeat');
        return `## 当前工作状态（STATE，与心跳循环共享）\n\n${readState()}\n\n对话中得知新的进展、决定或用户授权时，主动建议更新 STATE（用户可用 /state 查看）。`;
      } catch {
        return '';
      }
    },
  });

  prompt.register({
    id: 'memory',
    priority: 60,
    render: () => {
      const runtime = createRuntimeContext();
      if (!runtime.activeJob) return '';
      return buildChatMemoryContext({
        jobId: runtime.activeJobId,
        channels: runtime.enabledChannels.map(channel => channel.channel),
      });
    },
  });

  prompt.register({
    id: 'conversation-memory',
    priority: 70,
    render: () => {
      const runtime = createRuntimeContext();
      return runtime.activeJob ? buildConversationMemory(runtime.activeJobId) : '';
    },
  });

  prompt.register({
    id: 'auto-memory',
    priority: 80,
    render: () => {
      try {
        const { getMemoryContext } = require('../auto-memory');
        return getMemoryContext();
      } catch {
        return '';
      }
    },
  });

  prompt.register({
    id: 'skill-catalog',
    priority: 90,
    render: () => {
      try {
        const { skillCatalog } = require('../skills/claude-skills');
        const catalog = skillCatalog();
        if (!catalog) return '';
        return `## 外部招聘技能资产\n\n以下技能可通过 use_recruiting_skill 工具调用（用户也可用 /技能名 直接触发）。它们是知识来源、执行素材和未产品化场景的兜底；涉及已接入的 HireSeek 产品协议时，产品协议优先，skill 不能覆盖代码层护栏、工具策略或结构化输出契约。\n\n${catalog}`;
      } catch {
        return '';
      }
    },
  });

  prompt.register({
    id: 'chat-guide',
    priority: 100,
    render: () => CHAT_GUIDE,
  });
}

export function buildSystemPrompt(): string {
  const { getHarness } = require('../runtime') as typeof import('../runtime');
  return getHarness().systemPrompt.assemble();
}
