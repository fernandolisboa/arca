import pg from 'pg';

export const admin = new pg.Client({ host: '127.0.0.1', user: 'postgres' });
