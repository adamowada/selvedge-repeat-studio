import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { rollupOptions: { output: { manualChunks: { vendor: ['react', 'react-dom/client', 'react-konva/lib/ReactKonvaCore', './src/core/konva'] } } } },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'], environment: 'node',
    coverage: {
      provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/main.tsx', 'src/smokeBridge.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { statements: 60, branches: 50, functions: 55, lines: 70 },
    },
  },
});
