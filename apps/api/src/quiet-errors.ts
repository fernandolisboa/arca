import { definePlugin } from 'nitro';

/**
 * h3 prints every unhandled error, message and stack included, before the error handler runs.
 * The error handler logs the allow-listed fields instead (spec 0001, R3).
 */
export default definePlugin((nitroApp) => {
  const { h3 } = nitroApp;
  if (h3 === undefined) throw new Error('the Nitro app has no h3 instance to silence');
  h3.config.silent = true;
});
