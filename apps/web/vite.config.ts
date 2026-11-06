import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { defaultLocale, resources } from '@arca/i18n';
import { isUnpublishedFile } from '@arca/security-policy';
import { axes, fontPairs, palettes } from '@arca/ui/theme';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';

const messages = resources[defaultLocale].translation;
/** The default palette's background, also the static `theme-color` in index.html (spec 0006, R7). */
const defaultBackground = palettes[axes.theme.default][axes.mode.default].bg;

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
  background_color: defaultBackground,
  theme_color: defaultBackground,
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
const appearanceBootFile = 'appearance-boot.js';
const recoveryBootFile = 'recovery-boot.js';

const defaultPair = fontPairs[axes.font.default];
const defaultFontFiles = [defaultPair.display, defaultPair.body, defaultPair.numeric].map(
  (role) => `assets/${role.source.id}-latin`,
);

/**
 * Only the default font pair is precached; other pairs load from the network when chosen and fall
 * back to the system font offline (spec 0006, R4).
 */
const isOptionalFont = (file: string) =>
  file.endsWith('.woff2') && !defaultFontFiles.some((prefix) => file.startsWith(prefix));

/** Never precached: what the server does not publish, the worker itself and optional fonts. */
const notPrecached = (file: string) =>
  file === serviceWorkerFile || isUnpublishedFile(file) || isOptionalFont(file);

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

/** One TypeScript entry built as a classic script into the app's output, outside its bundle. */
async function buildScript(
  outDir: string,
  entry: string,
  name: string,
  fileName: string,
  define: Record<string, string> = {},
) {
  await build({
    configFile: false,
    logLevel: 'warn',
    define: { ...define, 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      lib: {
        entry: resolve(import.meta.dirname, entry),
        formats: ['iife'],
        name,
        fileName: () => fileName,
      },
    },
  });
}

/**
 * Writes the manifest, adds the appearance and recovery boot scripts to the page and, after the
 * app build, builds those scripts and then the service worker with Workbox bundled
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
    // The boot script runs before first paint, after the stylesheet so `--arca-bg` is resolved
    // (spec 0006, R7). Production only: in development the app applies the preferences on load.
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'script', attrs: { src: `/${appearanceBootFile}` }, injectTo: 'head' },
        { tag: 'script', attrs: { src: `/${recoveryBootFile}` }, injectTo: 'head' },
      ],
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(manifest),
      });
    },
    async closeBundle() {
      // The boot scripts first, so the precache list includes them.
      await buildScript(outDir, 'src/appearance/boot.ts', 'arcaAppearanceBoot', appearanceBootFile);
      await buildScript(outDir, 'src/pwa/recovery-boot.ts', 'arcaRecoveryBoot', recoveryBootFile);
      await buildScript(
        outDir,
        'src/service-worker/sw.ts',
        'arcaServiceWorker',
        serviceWorkerFile,
        {
          precacheManifest: JSON.stringify(await precacheManifest(outDir)),
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react' }), react(), tailwindcss(), pwa()],
  build: {
    // Read by the bundle check (tooling/scripts/src/check-web-bundle.ts); never served.
    sourcemap: 'hidden',
    // `default-src 'self'` blocks data: fonts, so font files always stay files (spec 0006, R4).
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
});
