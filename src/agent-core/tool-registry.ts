import type OpenAI from 'openai';

export type ToolCategory =
  | 'browser'
  | 'file'
  | 'search'
  | 'db'
  | 'feishu'
  | 'llm'
  | 'workflow'
  | 'memory'
  | 'git'
  | 'shell'
  | 'mcp'
  | 'other';

export type ToolExecutionMode = 'read' | 'dry_run' | 'prepare' | 'screen' | 'execute';

export interface ToolPolicy {
  category: ToolCategory;
  sideEffect: boolean;
  requiresApproval: boolean;
  supportsDryRun: boolean;
}

export interface RegisteredTool {
  name: string;
  schema: OpenAI.ChatCompletionTool;
  policy: ToolPolicy;
  policyDeclared: boolean;
}

export interface RegistryValidationIssue {
  tool: string;
  problem: string;
}

const DEFAULT_POLICY: ToolPolicy = {
  category: 'other',
  sideEffect: false,
  requiresApproval: false,
  supportsDryRun: false,
};

export const CORE_TOOL_POLICIES: Record<string, Partial<ToolPolicy>> = {
  browser: { category: 'browser', sideEffect: true, supportsDryRun: true },
  browser_connect: { category: 'browser', sideEffect: false },
  browser_snapshot: { category: 'browser', sideEffect: false },
  browser_act: { category: 'browser', sideEffect: true },
  computer: { category: 'browser', sideEffect: true, supportsDryRun: true },
  record_contacted: { category: 'db', sideEffect: false, supportsDryRun: true },
  record_screened_candidate: { category: 'db', sideEffect: false, supportsDryRun: true },
  prepare_contact: { category: 'workflow', sideEffect: false, supportsDryRun: false },
  run_shell: { category: 'shell', sideEffect: false, requiresApproval: true },
  read_file: { category: 'file', sideEffect: false },
  read_code: { category: 'file', sideEffect: false },
  read_pdf: { category: 'file', sideEffect: false },
  write_file: { category: 'file', sideEffect: true, requiresApproval: true },
  write_code: { category: 'file', sideEffect: true, requiresApproval: true },
  web_search: { category: 'search', sideEffect: false },
  glob: { category: 'file', sideEffect: false },
  grep: { category: 'file', sideEffect: false },
  list_candidates: { category: 'db', sideEffect: false },
  search_candidate: { category: 'db', sideEffect: false },
  search_candidates: { category: 'db', sideEffect: false },
  get_funnel: { category: 'db', sideEffect: false },
  goal_board: { category: 'db', sideEffect: false },
  update_candidate: { category: 'db', sideEffect: true, requiresApproval: true },
  log_candidate_note: { category: 'memory', sideEffect: true },
  record_interview_outcome: { category: 'memory', sideEffect: true },
  remember: { category: 'memory', sideEffect: true },
  forget: { category: 'memory', sideEffect: true, requiresApproval: true },
  recall_memory: { category: 'memory', sideEffect: false },
  search_past_context: { category: 'memory', sideEffect: false },
  feishu_recruiting_stats: { category: 'feishu', sideEffect: false },
  sync_interview_outcomes: { category: 'feishu', sideEffect: true, supportsDryRun: true },
  run_sourcing: { category: 'workflow', sideEffect: true, requiresApproval: true },
  scan_inbox: { category: 'workflow', sideEffect: true },
  spawn_task: { category: 'workflow', sideEffect: true },
  check_tasks: { category: 'workflow', sideEffect: false },
  ask_user_choice: { category: 'workflow', sideEffect: false },
  ask_user_question: { category: 'workflow', sideEffect: false },
  manage_schedule: { category: 'workflow', sideEffect: true, supportsDryRun: false },
  use_recruiting_skill: { category: 'workflow', sideEffect: false },
  evolve: { category: 'llm', sideEffect: true, supportsDryRun: true },
  recalibrate_fit_definition: { category: 'llm', sideEffect: true, supportsDryRun: true },
  analyze_image: { category: 'llm', sideEffect: false },
  mcp_list_servers: { category: 'mcp', sideEffect: false },
  mcp_call_tool: { category: 'mcp', sideEffect: true, requiresApproval: true },
  mcp_read_resource: { category: 'mcp', sideEffect: false },
  core_status: { category: 'workflow', sideEffect: false },
  product_doctor: { category: 'workflow', sideEffect: false },
  platform_protocols: { category: 'workflow', sideEffect: false },
  recruiting_capabilities: { category: 'workflow', sideEffect: false },
  update_config: { category: 'file', sideEffect: true, requiresApproval: true },
  create_task: { category: 'db', sideEffect: true },
  update_task: { category: 'db', sideEffect: true },
  list_tasks: { category: 'db', sideEffect: false },
  git_status: { category: 'git', sideEffect: false },
  git_commit: { category: 'git', sideEffect: true, requiresApproval: true },
  git_create_branch: { category: 'git', sideEffect: true, requiresApproval: true },
  git_push: { category: 'git', sideEffect: true, requiresApproval: true },
  git_create_pr: { category: 'git', sideEffect: true, requiresApproval: true },
  list_permissions: { category: 'workflow', sideEffect: false },
  clear_permissions: { category: 'workflow', sideEffect: true, requiresApproval: true },
  enter_plan_mode: { category: 'workflow', sideEffect: true },
  exit_plan_mode: { category: 'workflow', sideEffect: true },
  list_hooks: { category: 'workflow', sideEffect: false },
  add_hook: { category: 'workflow', sideEffect: true, requiresApproval: true },
  remove_hook: { category: 'workflow', sideEffect: true, requiresApproval: true },
  export_session: { category: 'file', sideEffect: true },
  list_sessions: { category: 'file', sideEffect: false },
  open_session: { category: 'workflow', sideEffect: true },
  copy_session: { category: 'workflow', sideEffect: true },
};

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(schema: OpenAI.ChatCompletionTool, policy: Partial<ToolPolicy> = {}): void {
    const name = schema.function.name;
    this.tools.set(name, {
      name,
      schema,
      policy: { ...DEFAULT_POLICY, ...policy },
      policyDeclared: policy.category != null && typeof policy.sideEffect === 'boolean',
    });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  validate(): RegistryValidationIssue[] {
    const issues: RegistryValidationIssue[] = [];
    for (const tool of this.tools.values()) {
      if (tool.schema.type !== 'function') {
        issues.push({ tool: tool.name, problem: 'schema.type must be function' });
      }
      if (!tool.schema.function?.name) {
        issues.push({ tool: tool.name, problem: 'missing function.name' });
      }
      if (!tool.schema.function?.parameters) {
        issues.push({ tool: tool.name, problem: 'missing function.parameters schema' });
      }
      if (!tool.policy.category) {
        issues.push({ tool: tool.name, problem: 'missing policy.category' });
      }
      if (!tool.policyDeclared) {
        issues.push({ tool: tool.name, problem: 'category and sideEffect must be explicitly declared' });
      }
      if (typeof tool.policy.sideEffect !== 'boolean') {
        issues.push({ tool: tool.name, problem: 'missing policy.sideEffect' });
      }
      if (tool.policy.sideEffect && tool.policy.supportsDryRun && tool.policy.requiresApproval === undefined) {
        issues.push({ tool: tool.name, problem: 'dry-run side-effect tool must declare approval policy' });
      }
    }
    return issues;
  }
}

export function createToolRegistry(
  schemas: OpenAI.ChatCompletionTool[],
  policies: Record<string, Partial<ToolPolicy>> = CORE_TOOL_POLICIES,
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const schema of schemas) {
    registry.register(schema, policies[schema.function.name] ?? {});
  }
  return registry;
}

export function unknownToolResult(name: string): string {
  return JSON.stringify({
    ok: false,
    error: {
      code: 'unknown_tool',
      message: `未知工具：${name}`,
    },
  });
}
