import { sql } from '@vercel/postgres';

export const rows = await sql`SELECT 1`;
