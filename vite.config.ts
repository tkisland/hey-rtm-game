import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import securityHeaders from './server/security-headers.json';
import { parseCloudConfig } from './src/cloud-schema';

export default defineConfig(({ mode }) => {
  const admin = mode === 'admin';
  const env = loadEnv(mode, process.cwd(), '');
  const cloudTest = mode === 'cloud-test';
  const cloud = parseCloudConfig(cloudTest ? {apiKey:'demo-key', authDomain:'demo-hey-rtm.firebaseapp.com', projectId:'demo-hey-rtm', appId:'1:123:web:demo'} : env.VITE_FIREBASE_CONFIG);
  const template = readFileSync('src/editor-template.html', 'utf8');
  return {
    base: './',
    appType: 'mpa',
    preview: {headers:securityHeaders},
    define: { __ADMIN__: JSON.stringify(admin), __FIREBASE_CONFIG__:JSON.stringify(cloud), __FIREBASE_EMULATORS__:JSON.stringify(cloudTest) },
    plugins: [{
      name: 'separate-player-and-admin',
      transformIndexHtml(html) {
        html = html.replace('<!-- editor:template -->', template);
        return admin ? html : html.replace(/<!-- admin:start -->[\s\S]*?<!-- admin:end -->/g, '');
      },
      configureServer(server) {
        if (admin) return;
        server.middlewares.use((request, response, next) => {
          let path: string;
          try { path = decodeURIComponent(new URL((request.url ?? '/').replace(/^\/+/, '/'), 'http://localhost').pathname).replaceAll('\\', '/'); }
          catch { response.statusCode = 400; response.end(); return; }
          // Include Vite's extensionless pages and JS-to-TS source aliases.
          if (/(?:^|\/)(?:editor(?:\.html)?\/?|src\/editor(?:\.[jt]s)?)$/i.test(path)) {
            response.statusCode = 404; response.end('Not found'); return;
          }
          next();
        });
      },
    }],
    build: {
      manifest: true,
      outDir: admin ? 'dist-admin' : 'dist',
      rollupOptions: { input: admin ? { menu: 'index.html', game: 'game.html', editor: 'editor.html', admin: 'admin.html', rankings:'rankings.html',moderation:'moderation.html' } : { menu: 'index.html', game: 'game.html', admin: 'admin.html', rankings:'rankings.html',moderation:'moderation.html' } },
    },
  };
});
