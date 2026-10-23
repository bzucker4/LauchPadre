import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { launchPadreApiPlugin } from './src/devApiPlugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), launchPadreApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    middlewareMode: false,
    hmr: {
      clientPort: 443,
    },
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: true,
  },
});
