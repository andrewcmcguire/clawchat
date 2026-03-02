import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local before any other imports that depend on env vars
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

async function seedAdmin() {
  const { default: bcrypt } = await import("bcryptjs");
  const { Pool } = await import("pg");

  const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  // Create admin user (idempotent)
  await dbPool.query(
    `INSERT INTO users (email, name, password_hash, is_admin, auth_provider)
     VALUES ($1, $2, $3, true, 'credentials')
     ON CONFLICT (email) DO UPDATE SET
       password_hash = $3,
       is_admin = true,
       updated_at = NOW()`,
    [email, email.split("@")[0], hash]
  );

  // Add to workspace_members
  await dbPool.query(
    `INSERT INTO workspace_members (workspace_id, email, name, role, status, joined_at)
     VALUES ('default', $1, $2, 'admin', 'active', NOW())
     ON CONFLICT (workspace_id, email) DO UPDATE SET role = 'admin', status = 'active'`,
    [email, email.split("@")[0]]
  );

  // Set workspace owner
  await dbPool.query(
    "UPDATE workspaces SET owner_email = $1 WHERE id = 'default'",
    [email]
  );

  // Seed code channel
  await dbPool.query(
    `INSERT INTO channels (id, workspace_id, name, description, project_type)
     VALUES ('code', 'default', 'Code', 'Terminal-style coding channel with Drew', 'code')
     ON CONFLICT (id) DO UPDATE SET project_type = 'code'`
  );

  console.log(`Admin user created: ${email}`);
  console.log(`Code channel seeded`);
  await dbPool.end();
}

seedAdmin().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
