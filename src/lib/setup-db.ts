import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

async function setup() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/clawchat",
  });

  const dir = __dirname;

  // 1. Run schema (creates tables if not exist)
  const schema = readFileSync(join(dir, "schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("[setup] Schema applied");

  // 2. Run migration (ALTER TABLE + new tables idempotent)
  const migrationPath = join(dir, "migration.sql");
  if (existsSync(migrationPath)) {
    const migration = readFileSync(migrationPath, "utf-8");
    await pool.query(migration);
    console.log("[setup] Migration applied");
  }

  // 3. Run seed data if --seed flag passed
  if (process.argv.includes("--seed")) {
    const seedPath = join(dir, "seed-data.sql");
    if (existsSync(seedPath)) {
      const seed = readFileSync(seedPath, "utf-8");
      await pool.query(seed);
      console.log("[setup] Seed data loaded");
    }
  }

  await pool.end();
  console.log("[setup] Done");
}

setup().catch(console.error);
