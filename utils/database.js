const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // use env var
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = pool;
