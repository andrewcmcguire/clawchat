import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// In-memory presence store (per-process, good enough for single server)
const onlineUsers = new Map<string, { name: string; lastSeen: number }>();

// Clean stale entries older than 60 seconds
function cleanStale() {
  const cutoff = Date.now() - 60_000;
  for (const [email, data] of onlineUsers) {
    if (data.lastSeen < cutoff) onlineUsers.delete(email);
  }
}

// POST /api/presence — heartbeat to mark user as online
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  onlineUsers.set(session.user.email, {
    name: session.user.name || session.user.email,
    lastSeen: Date.now(),
  });

  cleanStale();
  return NextResponse.json({ online: true });
}

// GET /api/presence — list online users
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  cleanStale();

  const users = Array.from(onlineUsers.entries()).map(([email, data]) => ({
    email,
    name: data.name,
    lastSeen: data.lastSeen,
  }));

  return NextResponse.json(users);
}
