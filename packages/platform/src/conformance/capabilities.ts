import { capabilities as all, type Capabilities } from '../capabilities.js';
import { check, type ConformanceCase } from './check.js';

export function capabilitiesConformance(capabilities: Capabilities): ConformanceCase[] {
  return all.map((capability) => ({
    name: `reports ${capability} consistently`,
    run: async () => {
      const reason = capabilities.whyUnavailable(capability);
      check(
        capabilities.has(capability) === (reason === undefined),
        'has() and whyUnavailable() disagree',
      );
      check(
        [undefined, 'unsupported', 'needs-install'].includes(reason),
        `unknown reason ${String(reason)}`,
      );
      await Promise.resolve();
    },
  }));
}
