import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 以下为早期手写断言脚本（自带 main()，非 vitest 套件），用 npx tsx 单独运行
    exclude: [
      '**/node_modules/**',
      'src/evaluator/__tests__/evaluate.test.ts',
      'src/outreach/__tests__/outreach.test.ts',
      'src/pipeline/__tests__/pipeline.test.ts',
      'src/tracking/__tests__/tracking.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
