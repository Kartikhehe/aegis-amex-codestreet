import react from '@vitejs/plugin-react';
import process from 'node:process';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import jsconfigPaths from 'vite-jsconfig-paths';
import checker from 'vite-plugin-checker';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

  return defineConfig({
    plugins: [
      react(),
      jsconfigPaths(),
      checker({
        eslint: {
          useFlatConfig: true,
          lintCommand: 'eslint "./src/**/*.{js,jsx}"',
        },
        overlay: {
          initialIsOpen: false,
        },
      }),
    ],
    preview: {
      port: Number(process.env.VITE_APP_PORT || 5002),
    },
    server: {
      host: '0.0.0.0',
      port: Number(process.env.VITE_APP_PORT || 5002),
    },
    base: process.env.VITE_BASENAME || '/',
    build: {
      rollupOptions: {
        output: {
          // ECharts is ~500 kB and is used by three screens. Without an
          // explicit chunk it gets inlined into whichever route pulls it in
          // first, so that one page carries the whole library.
          manualChunks: {
            echarts: ['echarts', 'echarts-for-react/lib/core'],
            mui: ['@mui/material', '@mui/system'],
            vendor: ['react', 'react-dom', 'react-router'],
          },
        },
      },
      chunkSizeWarningLimit: 700,
    },
    resolve: {
      alias: {
        'package.json': path.resolve(__dirname, './package.json'),
      },
    },
  });
};
