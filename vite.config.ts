import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { game: 'index.html', editor: 'editor.html' } } },
});
