import { describe, expect, it } from 'vitest';

const baseQuestion = {
  question: '下一步怎么处理？',
  header: '下一步',
  multiSelect: false,
  options: [
    { label: '继续', description: '继续当前流程' },
    { label: '停止', description: '停止当前流程' },
  ],
};

describe('ask_user_question contract', () => {
  it('accepts one to three structured questions', async () => {
    const { validateAskUserQuestions } = await import('../src/ask-user');

    expect(() => validateAskUserQuestions({ questions: [baseQuestion] })).not.toThrow();
    expect(() => validateAskUserQuestions({
      questions: [baseQuestion, baseQuestion, baseQuestion],
    })).not.toThrow();
  });

  it('rejects empty and oversized question batches', async () => {
    const { validateAskUserQuestions } = await import('../src/ask-user');

    expect(() => validateAskUserQuestions({ questions: [] })).toThrow('至少需要 1 个问题');
    expect(() => validateAskUserQuestions({
      questions: [baseQuestion, baseQuestion, baseQuestion, baseQuestion],
    })).toThrow('最多支持 3 个问题');
  });

  it('requires two to four options per question', async () => {
    const { validateAskUserQuestions } = await import('../src/ask-user');

    expect(() => validateAskUserQuestions({
      questions: [{ ...baseQuestion, options: [{ label: '继续', description: '继续当前流程' }] }],
    })).toThrow('必须提供 2-4 个选项');

    expect(() => validateAskUserQuestions({
      questions: [{
        ...baseQuestion,
        options: [
          { label: '一', description: '一' },
          { label: '二', description: '二' },
          { label: '三', description: '三' },
          { label: '四', description: '四' },
          { label: '五', description: '五' },
        ],
      }],
    })).toThrow('必须提供 2-4 个选项');
  });

  it('exposes the same limits in the chat tool schema', async () => {
    const { CHAT_TOOLS } = await import('../src/chat');

    const askTool = CHAT_TOOLS.find(t => t.function.name === 'ask_user_question');
    const questionsSchema = (askTool?.function.parameters as any).properties.questions;
    const optionsSchema = questionsSchema.items.properties.options;

    expect(questionsSchema.minItems).toBe(1);
    expect(questionsSchema.maxItems).toBe(3);
    expect(optionsSchema.minItems).toBe(2);
    expect(optionsSchema.maxItems).toBe(4);
  });
});
