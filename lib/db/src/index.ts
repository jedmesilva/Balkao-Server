import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isLocal = process.env.DATABASE_URL.includes("localhost") || process.env.DATABASE_URL.includes("127.0.0.1");

// Supabase uses TLS with certificates signed by a trusted CA (Let's Encrypt).
// For non-local connections, enable SSL with full certificate verification.
// Only skip SSL entirely for local development (localhost/127.0.0.1).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: true },
  // Supabase free tier: 20 direct connections; Transaction Pooler: up to 200.
  // Keep max conservative to avoid exhausting the connection limit.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
