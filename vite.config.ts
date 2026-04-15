import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/orc-survivor/' : './',
  server: {
    port: 3000,
    host: '127.0.0.1'
  }
});
