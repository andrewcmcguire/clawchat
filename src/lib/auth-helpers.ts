import { auth } from "@/auth";
import pool from "@/lib/db";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireAuth();
  if (session.user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return session;
}

export async function logAudit(
  userEmail: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  details?: Record<string, unknown>
) {
  await pool.query(
    "INSERT INTO audit_log (user_email, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)",
    [userEmail, action, resourceType, resourceId || null, details ? JSON.stringify(details) : "{}"]
  );
}

export async function logUsage(
  userEmail: string,
  usageType: "llm_tokens" | "messages" | "api_calls" | "voice_minutes",
  amount: number,
  model?: string,
  metadata?: Record<string, unknown>
) {
  await pool.query(
    "INSERT INTO usage_log (user_email, usage_type, amount, model, metadata) VALUES ($1, $2, $3, $4, $5)",
    [userEmail, usageType, amount, model || null, metadata ? JSON.stringify(metadata) : "{}"]
  );
}
