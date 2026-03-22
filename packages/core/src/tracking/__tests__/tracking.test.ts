// @hireclaw/core/tracking — Tests

import {
  CandidateTracker,
  STATUS_TRANSITIONS,
  STATUS_LABELS,
} from '../index.js';
import type { CandidateStatus, TrackingEntry } from '../index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.log(`  ❌ ${message}`); }
}

console.log('\n📋 @hireclaw/core/tracking Tests\n');

// 1. Status transitions are valid
console.log('--- Status transitions ---');
{
  assert(STATUS_TRANSITIONS['new'].includes('contacted'), 'new → contacted is valid');
  assert(!STATUS_TRANSITIONS['joined'].includes('contacted'), 'joined → contacted is invalid (terminal)');
  assert(!STATUS_TRANSITIONS['rejected'].includes('contacted'), 'rejected → contacted is invalid (terminal)');
  assert(STATUS_TRANSITIONS['contacted'].includes('replied'), 'contacted → replied is valid');
  assert(STATUS_TRANSITIONS['interviewed'].includes('offered'), 'interviewed → offered is valid');
  assert(STATUS_TRANSITIONS['offered'].includes('joined'), 'offered → joined is valid');
}

// 2. Status labels exist for all statuses
console.log('\n--- Status labels ---');
{
  const allStatuses: CandidateStatus[] = ['new', 'contacted', 'replied', 'screening', 'interviewed', 'offered', 'joined', 'rejected', 'dropped'];
  for (const s of allStatuses) {
    assert(STATUS_LABELS[s] !== undefined, `Label exists for ${s}: ${STATUS_LABELS[s]}`);
  }
}

// 3. Register and track a candidate
console.log('\n--- Register candidate ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  const entry = tracker.register('c1', '张三', 'boss');

  assert(entry.candidateId === 'c1', `ID: ${entry.candidateId}`);
  assert(entry.candidateName === '张三', `Name: ${entry.candidateName}`);
  assert(entry.status === 'new', `Initial status: ${entry.status}`);
  assert(entry.history.length === 0, `No history yet`);
  assert(entry.outreachRecords.length === 0, `No outreach records yet`);
}

// 4. Status transition
console.log('\n--- Status transition ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三');
  tracker.transition('c1', 'contacted', '发送第一条消息');

  const entry = tracker.get('c1')!;
  assert(entry.status === 'contacted', `Status: ${entry.status}`);
  assert(entry.history.length === 1, `History length: ${entry.history.length}`);
  assert(entry.history[0].from === 'new', `From: ${entry.history[0].from}`);
  assert(entry.history[0].to === 'contacted', `To: ${entry.history[0].to}`);
  assert(entry.history[0].reason === '发送第一条消息', `Reason: ${entry.history[0].reason}`);
}

// 5. Invalid transition throws
console.log('\n--- Invalid transition ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三');
  tracker.transition('c1', 'contacted');

  let threw = false;
  try {
    tracker.transition('c1', 'interviewed'); // Skip replied → screening
  } catch (err) {
    threw = true;
    assert((err as Error).message.includes('Invalid status transition'), `Error: ${(err as Error).message}`);
  }
  assert(threw, 'Invalid transition throws error');
}

// 6. Terminal states cannot transition
console.log('\n--- Terminal states ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三');

  // Walk to joined
  tracker.transition('c1', 'contacted');
  tracker.transition('c1', 'replied');
  tracker.transition('c1', 'screening');
  tracker.transition('c1', 'interviewed');
  tracker.transition('c1', 'offered');
  tracker.transition('c1', 'joined');

  let threw = false;
  try {
    tracker.transition('c1', 'contacted');
  } catch {
    threw = true;
  }
  assert(threw, 'Cannot transition from terminal state (joined)');
}

// 7. Full funnel flow
console.log('\n--- Full funnel flow ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三');
  tracker.transition('c1', 'contacted');
  tracker.transition('c1', 'replied', '简历不错');
  tracker.transition('c1', 'screening');
  tracker.transition('c1', 'interviewed');
  tracker.transition('c1', 'offered');
  tracker.transition('c1', 'joined');

  const entry = tracker.get('c1')!;
  assert(entry.status === 'joined', `Final status: ${entry.status}`);
  assert(entry.history.length === 6, `History entries: ${entry.history.length}`);
}

// 8. Record outreach events
console.log('\n--- Record outreach events ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三', 'boss');
  tracker.recordOutreach('c1', { type: 'sent', platform: 'boss', content: '你好张三...', result: 'sent' });

  const entry = tracker.get('c1')!;
  assert(entry.status === 'contacted', `Auto-transitioned to contacted`);
  assert(entry.outreachRecords.length === 1, `Outreach records: ${entry.outreachRecords.length}`);
  assert(entry.outreachRecords[0].platform === 'boss', `Platform: ${entry.outreachRecords[0].platform}`);

  // Record reply
  tracker.recordOutreach('c1', { type: 'received', platform: 'boss', result: 'replied' });
  assert(entry.status === 'replied', `Auto-transitioned to replied: ${entry.status}`);
}

// 9. Multiple candidates
console.log('\n--- Multiple candidates ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三');
  tracker.register('c2', '李四');
  tracker.register('c3', '王五');

  tracker.transition('c1', 'contacted');
  tracker.transition('c1', 'replied');
  tracker.transition('c2', 'contacted');
  tracker.transition('c3', 'contacted');
  tracker.transition('c3', 'dropped');

  const all = tracker.getAll();
  assert(all.length === 3, `Total entries: ${all.length}`);

  const contacted = tracker.getByStatus('contacted');
  assert(contacted.length === 1, `Contacted: ${contacted.length}`);

  const replied = tracker.getByStatus('replied');
  assert(replied.length === 1, `Replied: ${replied.length}`);

  const dropped = tracker.getByStatus('dropped');
  assert(dropped.length === 1, `Dropped: ${dropped.length}`);
}

// 10. Funnel stats
console.log('\n--- Funnel stats ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三');
  tracker.transition('c1', 'contacted');
  tracker.transition('c1', 'replied');

  tracker.register('c2', '李四');
  tracker.transition('c2', 'contacted');

  tracker.register('c3', '王五');

  tracker.register('c4', '赵六');
  tracker.transition('c4', 'contacted');
  tracker.transition('c4', 'dropped');

  const stats = tracker.getFunnelStats();
  assert(stats.new === 1, `New: ${stats.new}`);
  assert(stats.contacted === 1, `Contacted: ${stats.contacted}`);
  assert(stats.replied === 1, `Replied: ${stats.replied}`);
  assert(stats.dropped === 1, `Dropped: ${stats.dropped}`);
  assert(stats.interviewed === 0, `Interviewed: ${stats.interviewed}`);
}

// 11. Follow-up reminders
console.log('\n--- Follow-up reminders ---');
{
  const tracker = new CandidateTracker();
  await tracker.init();

  tracker.register('c1', '张三');
  tracker.transition('c1', 'contacted');

  // Manually set timestamp to simulate old activity
  const entry = tracker.get('c1')!;
  entry.history[0].timestamp = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const reminders = tracker.getFollowUpReminders({ maxDaysSinceActivity: 3 });
  assert(reminders.length === 1, `Reminders: ${reminders.length}`);
  assert(reminders[0].candidateId === 'c1', `Candidate: ${reminders[0].candidateId}`);
  assert(reminders[0].daysSinceActivity >= 5, `Days since: ${reminders[0].daysSinceActivity}`);
  assert(reminders[0].suggestedAction.includes('触达'), `Action: ${reminders[0].suggestedAction}`);
}

// 12. Save and reload
console.log('\n--- Save and reload ---');
{
  const tmpDir = `C:\\Users\\Kino Xuan\\.openclaw-autoclaw\\workspace\\hireclaw\\.tmp-test-${Date.now()}`;
  const storagePath = `${tmpDir}\\tracking.json`;

  const tracker1 = new CandidateTracker({ storagePath });
  await tracker1.init();
  tracker1.register('c1', '张三');
  tracker1.transition('c1', 'contacted');
  tracker1.transition('c1', 'replied');
  await tracker1.save();

  const tracker2 = new CandidateTracker({ storagePath });
  await tracker2.init();
  const entry = tracker2.get('c1');
  assert(entry !== undefined, 'Entry exists after reload');
  assert(entry!.status === 'replied', `Status after reload: ${entry!.status}`);
  assert(entry!.history.length === 2, `History after reload: ${entry!.history.length}`);

  // Cleanup
  const { rmSync } = await import('node:fs');
  rmSync(tmpDir, { recursive: true, force: true });
}

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`✅ ${passed} passed | ❌ ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
