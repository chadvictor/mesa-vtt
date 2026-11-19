import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@systems': path.resolve(__dirname, '../systems'),
      '@data': path.resolve(__dirname, '../data'),
    },
  },
  server: {
    host: true,
    port: 3104,
    strictPort: false,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8094',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8094',
        ws: true,
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://127.0.0.1:8094',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
