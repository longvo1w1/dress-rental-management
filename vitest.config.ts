import { defineConfig } from 'vitest/config';
export default defineConfig({ root: '.', test: { include: ['shared/**/*.test.ts'] } });
