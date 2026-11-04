import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ChosenFile, ConformanceResult } from '../src/conformance/index.js';
import type * as Web from '../src/conformance/web.js';
import type * as WebPlatform from '../src/web-platform.js';

type WebSuite = Web.WebSuite;

/** What the served page puts on `globalThis` once the built modules load. */
interface Loaded {
  readonly arca: { readonly web: typeof Web; readonly platform: typeof WebPlatform };
  readonly arcaChooseFiles: (choice: readonly ChosenFile[]) => Promise<void>;
}

const blankPage = `<!doctype html><title>Platform conformance</title><script type="module">
import * as web from '/dist/conformance/web.js';
import * as platform from '/dist/web-platform.js';
globalThis.arca = { web, platform };
</script>`;

const dist = new URL('../dist/', import.meta.url);
const origins = ['https://arca.example.com', 'https://other.example.com'] as const;

/** Each origin serves a page that loads the built package, so the adapters run as the app runs them. */
async function serve(context: BrowserContext): Promise<void> {
  for (const origin of origins) {
    await context.route(`${origin}/**`, async (route) => {
      const { pathname } = new URL(route.request().url());
      if (!pathname.startsWith('/dist/')) {
        await route.fulfill({ contentType: 'text/html', body: blankPage });
        return;
      }
      const file = new URL(pathname.slice('/dist/'.length), dist);
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(file) });
    });
  }
}

const served = new WeakSet<BrowserContext>();

async function open(tab: Page, origin: string = origins[0]): Promise<void> {
  if (!served.has(tab.context())) {
    served.add(tab.context());
    await serve(tab.context());
  }
  await tab.goto(`${origin}/`);
  await tab.waitForFunction(() => 'arca' in globalThis);
}

/** Answers file choosers with what the suite asked for, as a person would. */
async function answerFileChoosers(page: Page): Promise<void> {
  let choice: readonly ChosenFile[] = [];
  await page.exposeFunction('arcaChooseFiles', (next: readonly ChosenFile[]) => {
    choice = next;
  });
  page.on('filechooser', (chooser) => {
    void chooser.setFiles(
      choice.map((file) => ({
        name: file.name,
        mimeType: file.type,
        buffer: Buffer.from(file.content),
      })),
    );
  });
}

function run(tab: Page, suite: WebSuite): Promise<ConformanceResult[]> {
  return tab.evaluate((name) => {
    const { arca, arcaChooseFiles } = globalThis as unknown as Loaded;
    return arca.web.runWebConformance(name, (choice) => arcaChooseFiles(choice));
  }, suite);
}

const suites: readonly WebSuite[] = [
  'capabilities',
  'files',
  'keyStorage',
  'notifications',
  'sharing',
  'deepLinks',
];

test.describe('the web adapters pass the conformance suites (spec 0005, R5)', () => {
  for (const suite of suites) {
    test(suite, async ({ page }) => {
      await answerFileChoosers(page);
      await open(page);
      const results = await run(page, suite);
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter((result) => result.error !== undefined)).toEqual([]);
    });
  }
});

/** What the page's web capabilities report. */
function report(tab: Page) {
  return tab.evaluate(() => {
    const { capabilities } = (globalThis as unknown as Loaded).arca.platform.createWebPlatform();
    return {
      notifications: capabilities.whyUnavailable('notifications'),
      receiveSharedFiles: capabilities.has('receiveSharedFiles'),
    };
  });
}

test.describe('web capabilities (spec 0005, R5)', () => {
  test('receiving shared files is unavailable in a browser without a share target', async ({
    page,
  }) => {
    await open(page);
    expect((await report(page)).receiveSharedFiles).toBe(false);
  });

  for (const userAgent of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36',
  ]) {
    test(`notifications need installing without the Push API, whatever the user agent says: ${userAgent.slice(13, 32)}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ userAgent });
      const page = await context.newPage();
      await open(page);
      expect((await report(page)).notifications).toBeUndefined();
      await page.addInitScript(() => {
        Reflect.deleteProperty(globalThis, 'PushManager');
      });
      await page.reload();
      await page.waitForFunction(() => 'arca' in globalThis);
      expect((await report(page)).notifications).toBe('needs-install');
      await context.close();
    });
  }
});

interface Wrapped {
  readonly extractable: boolean;
  readonly algorithm: string;
  readonly length: number;
  readonly usages: readonly string[];
  readonly iv: number[];
}

const context = {
  accountId: '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e',
  relyingPartyId: 'arca.example.com',
};

/** Stores a synthetic secret through the adapter and returns what IndexedDB holds for it. */
function storeAndInspect(tab: Page) {
  return tab.evaluate(async (keyContext) => {
    const { createWebPlatform } = (globalThis as unknown as Loaded).arca.platform;
    await createWebPlatform().keyStorage.store(keyContext, new Uint8Array(32).fill(9));
    return new Promise<Wrapped & { ciphertext: number[] }>((resolve) => {
      const request = indexedDB.open('arca-key-storage');
      request.onsuccess = () => {
        const get = request.result.transaction('secrets').objectStore('secrets').get('vault');
        get.onsuccess = () => {
          const record = get.result as { key: CryptoKey; iv: Uint8Array; ciphertext: ArrayBuffer };
          const algorithm = record.key.algorithm as AesKeyAlgorithm;
          request.result.close();
          resolve({
            extractable: record.key.extractable,
            algorithm: algorithm.name,
            length: algorithm.length,
            usages: [...record.key.usages].sort(),
            iv: [...record.iv],
            ciphertext: [...new Uint8Array(record.ciphertext)],
          });
        };
      };
    });
  }, context);
}

test.describe('web key storage (spec 0005, R5)', () => {
  test('wraps with a non-extractable AES-GCM-256 key and a fresh 96-bit IV', async ({ page }) => {
    await open(page);
    const first = await storeAndInspect(page);
    const second = await storeAndInspect(page);
    expect(first).toMatchObject({
      extractable: false,
      algorithm: 'AES-GCM',
      length: 256,
      usages: ['decrypt', 'encrypt'],
    });
    expect(first.iv).toHaveLength(12);
    expect(second.iv).not.toEqual(first.iv);
  });

  test('a blob moved to another origin does not open there', async ({ page }) => {
    await open(page, origins[0]);
    const moved = await storeAndInspect(page);
    await open(page, origins[1]);
    await storeAndInspect(page);
    const status = await page.evaluate(
      async ({ blob, keyContext }) => {
        await new Promise<void>((resolve) => {
          const request = indexedDB.open('arca-key-storage');
          request.onsuccess = () => {
            const store = request.result.transaction('secrets', 'readwrite').objectStore('secrets');
            const get = store.get('vault');
            get.onsuccess = () => {
              const record = get.result as Record<string, unknown>;
              const put = store.put(
                {
                  ...record,
                  iv: new Uint8Array(blob.iv),
                  ciphertext: new Uint8Array(blob.ciphertext).buffer,
                },
                'vault',
              );
              put.onsuccess = () => {
                request.result.close();
                resolve();
              };
            };
          };
        });
        const { createWebPlatform } = (globalThis as unknown as Loaded).arca.platform;
        return (await createWebPlatform().keyStorage.load(keyContext)).status;
      },
      { blob: moved, keyContext: context },
    );
    expect(status).toBe('not stored');
  });
});
