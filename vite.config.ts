import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/__malenjo_ai/ollama/api/tags': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: false,
        rewrite: () => '/api/tags',
      },
      '/__malenjo_ai/ollama/api/chat': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: false,
        rewrite: () => '/api/chat',
      },
      '/__malenjo_ai/llama/v1/models': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
        rewrite: () => '/v1/models',
      },
      '/__malenjo_ai/llama/v1/chat/completions': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
        rewrite: () => '/v1/chat/completions',
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: ['es2022', 'chrome105', 'safari13'] },
});
