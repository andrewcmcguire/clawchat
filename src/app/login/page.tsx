"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#00d4a8]/20">
            <span className="text-xl font-bold text-[#00d4a8]">S</span>
          </div>
          <h1 className="text-xl font-bold text-[#e4e4e7]">SteadyChat</h1>
          <p className="mt-1 text-[13px] text-[#71717a]">Sign in to your workspace</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#e4e4e7]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3.5 py-2.5 text-[15px] text-[#e4e4e7] placeholder-[#71717a] outline-none transition-colors focus:border-[#00d4a8]/50"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#e4e4e7]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3.5 py-2.5 text-[15px] text-[#e4e4e7] placeholder-[#71717a] outline-none transition-colors focus:border-[#00d4a8]/50"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-lg bg-[#00d4a8] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-6 text-center text-[12px] text-[#71717a]">
          Invite-only workspace. Contact your admin for access.
        </p>
      </div>
    </div>
  );
}
