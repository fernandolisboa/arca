import { writeFile } from 'node:fs/promises';
import { serializeOpenApiDocument } from '../dist/server/index.js';

await writeFile(new URL('../openapi.json', import.meta.url), serializeOpenApiDocument());
