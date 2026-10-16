import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const admin = mode === 'admin';
  return {
    base: './',
    appType: 'mpa',
    define: { __ADMIN__: JSON.stringify(admin) },
    plugins: [{
      name: 'separate-player-and-admin',
      transformIndexHtml(html) {
        return admin ? html : html.replace(/<!-- admin:start -->[\s\S]*?<!-- admin:end -->/g, '');
      },
      configureServer(server) {
        if (admin) return;
        server.middlewares.use((request, response, next) => {
          let path: string;
          try { path = decodeURIComponent(new URL((request.url ?? '/').replace(/^\/+/, '/'), 'http://localhost').pathname).replaceAll('\\', '/'); }
          catch { response.statusCode = 400; response.end(); return; }
          // Include Vite's extensionless pages and JS-to-TS source aliases.
          if (/(?:^|\/)(?:editor(?:\.html)?\/?|src\/(?:editor(?:-preview)?|timeline)(?:\.[^/]+)?)$/i.test(path)) {
            response.statusCode = 404; response.end('Not found'); return;
          }
          next();
        });
      },
    }],
    build: {
      outDir: admin ? 'dist-admin' : 'dist',
      rollupOptions: { input: admin ? { menu: 'index.html', game: 'game.html', editor: 'editor.html' } : { menu: 'index.html', game: 'game.html' } },
    },
  };
});
