import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/maps/',
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    // routing lives on the VPS; in development the same path is proxied there
    proxy: { '/maps/api': { target: 'https://alexe.pt', changeOrigin: true } },
  },
});
