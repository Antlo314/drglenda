import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page build: the public marketing site (index.html) and the gated
// student/admin portal (portal.html) are two separate entry points.
export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        portal: resolve(__dirname, 'portal.html'),
      },
    },
  },
});
