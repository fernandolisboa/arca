import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { defaultLocale, resources } from '@arca/i18n';
import { isUnpublishedFile } from '@arca/security-policy';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';

const messages = resources[defaultLocale].translation;
const themeColor = '#1d5b69';

/** The web app manifest, in pt-BR from the catalog (spec 0001, R5). */
const manifest = {
  name: messages.app.name,
  short_name: messages.app.name,
  description: messages.app.description,
  lang: defaultLocale,
  dir: 'ltr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f7f9fa',
  theme_color: themeColor,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    {
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

const serviceWorkerFile = 'sw.js';

/** Never precached: what the server does not publish, and the worker itself. */
const notPrecached = (file: string) => file === serviceWorkerFile || isUnpublishedFile(file);

async function precacheManifest(outDir: string) {
  const files = (await readdir(outDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((file) => !notPrecached(file))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      url: `/${file}`,
      revision: createHash('sha256')
        .update(await readFile(join(outDir, file)))
        .digest('hex')
        .slice(0, 16),
    })),
  );
}

/**
 * Writes the manifest and, after the app build, builds the service worker with Workbox bundled
 * in (no importScripts, since Trusted Types apply inside the worker) and the list of built files
 * to precache. A small plugin instead of vite-plugin-pwa, whose workbox-build dependency pulls
 * in a fork with a provenance downgrade that the lockfile policy rejects.
 */
function pwa(): Plugin {
  let outDir = '';
  return {
    name: 'arca-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(manifest),
      });
    },
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        define: {
          precacheManifest: JSON.stringify(await precacheManifest(outDir)),
          'process.env.NODE_ENV': JSON.stringify('production'),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          lib: {
            entry: resolve(import.meta.dirname, 'src/service-worker/sw.ts'),
            formats: ['iife'],
            name: 'arcaServiceWorker',
            fileName: () => serviceWorkerFile,
          },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react' }), react(), tailwindcss(), pwa()],
  build: {
    // Read by the bundle check (tooling/scripts/src/check-web-bundle.ts); never served.
    sourcemap: 'hidden',
  },
});
