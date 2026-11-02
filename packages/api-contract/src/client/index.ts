// First, so it runs before the route schemas are built.
import './jitless.js';
import type { z } from 'zod';
import { apiBasePath, ErrorResponse, type RouteDefinition } from '../routes/index.js';

export { routes } from '../routes/index.js';
export type { HealthResponse } from '../routes/index.js';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Origin of the API: empty for the web build (same origin), absolute for native builds. */
  readonly origin: string;
  readonly fetch?: Fetch;
}

/** The API answered with an error status; `code` comes from its `{ error: { code } }` body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`API error ${String(status)}: ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The response did not match the contract, so client and server have drifted apart. */
export class ContractViolationError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super(`Response for ${operationId} does not match the API contract`);
    this.name = 'ContractViolationError';
    this.operationId = operationId;
  }
}

export interface ApiClient {
  call<Route extends RouteDefinition>(route: Route): Promise<z.infer<Route['response']['schema']>>;
}

export function createApiClient({ origin, fetch = globalThis.fetch }: ApiClientOptions): ApiClient {
  return {
    async call<Route extends RouteDefinition>(
      route: Route,
    ): Promise<z.infer<Route['response']['schema']>> {
      const response = await fetch(`${origin}${apiBasePath}${route.path}`, {
        method: route.method.toUpperCase(),
        headers: { accept: 'application/json' },
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ErrorResponse.safeParse(body);
        throw new ApiError(response.status, parsed.success ? parsed.data.error.code : 'unknown');
      }
      const parsed = route.response.schema.safeParse(body);
      if (!parsed.success) throw new ContractViolationError(route.operationId);
      return parsed.data as z.infer<Route['response']['schema']>;
    },
  };
}
