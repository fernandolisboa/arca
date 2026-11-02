import { config } from 'zod';

// Clients run under a CSP without 'unsafe-eval' and with Trusted Types (spec 0001, R4). Zod's JIT
// probes `new Function` when an object schema is built, which those policies report as a violation
// even though Zod catches the error. This module must load before any schema is defined.
config({ jitless: true });
