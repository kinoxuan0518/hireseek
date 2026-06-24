import { describe, it, expect, afterEach } from 'vitest';
import { checkPermission, setHeadless } from '../src/permissions';

/**
 * 验证「闸门读 registry」：tool-registry 的 requiresApproval 真正驱动 gate，
 * 而非只供 doctor 计数。用合成工具名避免命中已保存规则，无头模式保证确定性（不弹 readline）。
 */
describe('permission gate reads registry requiresApproval', () => {
  afterEach(() => setHeadless(false));

  it('headless: requiresApproval=true → 拒绝（即便不在旧危险列表）', async () => {
    setHeadless(true);
    const approved = await checkPermission({
      toolName: '__gate_test_tool__', // 合成名：旧 isDangerousTool 判定为安全
      args: {},
      requiresApproval: true,         // registry 说要审批 → 必须进闸门
    });
    expect(approved).toBe(false);
  });

  it('headless: requiresApproval=false 且非危险 → 放行', async () => {
    setHeadless(true);
    const approved = await checkPermission({
      toolName: '__gate_test_tool__',
      args: {},
      requiresApproval: false,
    });
    expect(approved).toBe(true);
  });

  it('headless: 旧危险工具(forget)即便没传 requiresApproval 仍被拦', async () => {
    setHeadless(true);
    const approved = await checkPermission({ toolName: 'forget', args: {} });
    expect(approved).toBe(false);
  });

  it('显式 dry_run + supportsDryRun → 放行（预览无副作用，免审批）', async () => {
    setHeadless(true);
    const approved = await checkPermission({
      toolName: '__gate_test_tool__',
      args: {},
      requiresApproval: true,
      explicitMode: 'dry_run',
      supportsDryRun: true,
    });
    expect(approved).toBe(true);
  });

  it('run_shell 陷阱：requiresApproval 但没显式 mode（默认 read）仍必须被拦', async () => {
    // run_shell 是 sideEffect=false → 默认解析成 read。若误用"read 即免审批"会放行 shell。
    setHeadless(true);
    const approved = await checkPermission({
      toolName: 'run_shell',
      args: { command: 'echo hi' },
      requiresApproval: true,
      explicitMode: undefined, // 没有调用方显式设 dry_run
      supportsDryRun: false,
    });
    expect(approved).toBe(false);
  });

  it('显式 execute + supportsDryRun 也不能免审批（execute 是真副作用）', async () => {
    setHeadless(true);
    const approved = await checkPermission({
      toolName: '__gate_test_tool__',
      args: {},
      requiresApproval: true,
      explicitMode: 'execute',
      supportsDryRun: true,
    });
    expect(approved).toBe(false);
  });
});
