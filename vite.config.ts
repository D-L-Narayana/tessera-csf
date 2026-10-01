import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle can be served from any sub-path (preview gallery requirement).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6120, strictPort: true, host: '127.0.0.1' },
  preview: { port: 6120, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['verbose'],
  },
});
