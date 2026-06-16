/**
 * AskUserQuestion - 结构化多选问答工具
 * 类似 Claude Code 的 AskUserQuestion 功能
 */

import readline from 'readline';
import chalk from 'chalk';
import { selectMultipleOptions, selectOption } from './select';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string; // 简短标签，如 "Auth method", "Library"
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionParams {
  questions: Question[];
}

export interface UserAnswers {
  [questionIndex: string]: string | string[];
}

let sharedReadline: readline.Interface | null = null;

export function setAskUserReadline(rl: readline.Interface | null): void {
  sharedReadline = rl;
}

function askLine(prompt: string): Promise<string> {
  if (sharedReadline) {
    return new Promise(resolve => sharedReadline!.question(prompt, resolve));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function optionChoices(question: Question): QuestionOption[] {
  return [
    ...question.options,
    { label: '其他', description: '自定义输入' },
  ];
}

async function askWithTextFallback(question: Question, prompt: string): Promise<string | string[]> {
  const answer = await askLine(prompt);

  if (question.multiSelect) {
    const selections = answer
      .split(/[,\uFF0C\u3001&\s]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 1 && n <= question.options.length + 1);

    if (selections.length === 0) {
      console.log(chalk.red('无效选择，请重新选择'));
      return askSingleQuestion(question, 0, 1);
    }

    if (selections.includes(question.options.length + 1)) {
      const customInput = await askLine('请输入自定义内容: ');
      const results = selections
        .filter(n => n <= question.options.length)
        .map(n => question.options[n - 1].label);
      if (customInput.trim()) results.push(customInput.trim());
      return results;
    }

    return selections.map(n => question.options[n - 1].label);
  }

  const selection = parseInt(answer.trim(), 10);
  if (isNaN(selection) || selection < 1 || selection > question.options.length + 1) {
    console.log(chalk.red('无效选择，请重新选择'));
    return askSingleQuestion(question, 0, 1);
  }

  if (selection === question.options.length + 1) {
    const customInput = await askLine('请输入自定义内容: ');
    return customInput.trim() || '未指定';
  }

  return question.options[selection - 1].label;
}

/**
 * 显示单个问题并获取用户选择
 */
async function askSingleQuestion(
  question: Question,
  questionIndex: number,
  totalQuestions: number
): Promise<string | string[]> {
  console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
  console.log(chalk.cyan(`问题 ${questionIndex + 1}/${totalQuestions}`));
  console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));

  console.log(chalk.gray(`[${question.header}]${question.multiSelect ? ' (可多选)' : ''}`));

  const prompt = question.multiSelect
    ? `请选择（多选用逗号分隔，如 "1,3"）: `
    : `请选择 (1-${question.options.length + 1}): `;

  if (!process.stdin.isTTY) {
    question.options.forEach((opt, index) => {
      console.log(chalk.yellow(`${index + 1}. ${opt.label}`));
      console.log(chalk.gray(`   ${opt.description}\n`));
    });
    console.log(chalk.yellow(`${question.options.length + 1}. 其他`));
    console.log(chalk.gray(`   自定义输入\n`));
    return askWithTextFallback(question, prompt);
  }

  const choices = optionChoices(question);
  const selectQuestion = question.question;
  const options = choices.map(o => ({ label: o.label, hint: o.description }));

  if (question.multiSelect) {
    const picked = await selectMultipleOptions(selectQuestion, options);
    if (picked == null) {
      console.log(chalk.red('已取消，请重新选择'));
      return askSingleQuestion(question, questionIndex, totalQuestions);
    }
    const customIndex = choices.length - 1;
    const results = picked
      .filter(i => i !== customIndex)
      .map(i => choices[i].label);
    if (picked.includes(customIndex)) {
      const customInput = await askLine('请输入自定义内容: ');
      if (customInput.trim()) results.push(customInput.trim());
    }
    return results.length > 0 ? results : askSingleQuestion(question, questionIndex, totalQuestions);
  }

  const picked = await selectOption(selectQuestion, options);
  if (picked == null) {
    console.log(chalk.red('已取消，请重新选择'));
    return askSingleQuestion(question, questionIndex, totalQuestions);
  }
  if (picked === choices.length - 1) {
    const customInput = await askLine('请输入自定义内容: ');
    return customInput.trim() || '未指定';
  }

  return choices[picked].label;
}

/**
 * 向用户询问一组问题
 */
export async function askUserQuestions(params: AskUserQuestionParams): Promise<UserAnswers> {
  const { questions } = params;

  if (questions.length === 0) {
    throw new Error('至少需要 1 个问题');
  }

  if (questions.length > 4) {
    throw new Error('最多支持 4 个问题');
  }

  const answers: UserAnswers = {};

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const answer = await askSingleQuestion(question, i, questions.length);
    answers[i.toString()] = answer;
  }

  console.log(chalk.green('\n✓ 问答完成\n'));

  return answers;
}

/**
 * 格式化用户回答为可读字符串
 */
export function formatAnswers(questions: Question[], answers: UserAnswers): string {
  let result = '用户回答：\n\n';

  Object.keys(answers).forEach((key, index) => {
    const question = questions[parseInt(key, 10)];
    const answer = answers[key];

    result += `${index + 1}. ${question.question}\n`;
    if (Array.isArray(answer)) {
      result += `   回答：${answer.join(', ')}\n\n`;
    } else {
      result += `   回答：${answer}\n\n`;
    }
  });

  return result;
}
