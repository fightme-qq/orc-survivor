import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/dungeon-crawler/' : './',
  server: {
    port: 3000,
    host: '127.0.0.1'
  }
});
