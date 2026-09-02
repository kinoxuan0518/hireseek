import type { Context } from './context';
import type { PromptSection } from './types';

export class PromptService {
  private readonly sections: PromptSection[] = [];

  register(section: PromptSection): () => void {
    this.sections.push(section);
    this.sections.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    return () => {
      const index = this.sections.indexOf(section);
      if (index >= 0) this.sections.splice(index, 1);
    };
  }

  list(): PromptSection[] {
    return this.sections.slice();
  }

  assemble(): string {
    return this.sections
      .map(section => section.render()?.trim())
      .filter((text): text is string => Boolean(text))
      .join('\n\n---\n\n');
  }
}

export function promptPlugin(ctx: Context): void {
  ctx.provide('systemPrompt', new PromptService());
}
