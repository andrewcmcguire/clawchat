# Steadybase — Platform Reference Doc

> Last updated: 2026-03-01 (v2)
> Live: https://app.steadybase.io
> Repo: https://github.com/andrewcmcguire/clawchat
> EC2: 44.254.64.158 (ubuntu@, key: steadybase-key.pem)

---

## What It Is

Steadybase is an AI-native operations hub. One AI brain ("Drew", Claude Opus) handles all user interactions — chat, task creation, contacts, calendar, code — across a dark-themed three-panel interface. It runs as a Next.js web app with a Capacitor iOS wrapper that points at the server.

---

## Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 (purple accent #8b5cf6, #0a0a0b bg) |
| Fonts | Inter (UI) + JetBrains Mono (code) |
| Database | PostgreSQL (local dev: localhost:5432/clawchat, prod: same host w/ auth) |
| Auth | NextAuth.js v5 beta.30 (JWT sessions, credentials provider) |
| AI | Claude CLI/SDK (OAuth, primary), Anthropic API (fallback), Google Gemini, OpenAI, LM Studio |
| Voice | OpenAI Whisper (transcription) + TTS |
| Realtime | Server-Sent Events (SSE) — no WebSockets |
| Mobile | Capacitor 8 iOS (remote server mode → 44.254.64.158) |
| Deploy | AWS EC2 + PM2 + nginx + Let's Encrypt |
| File storage | Local (`uploads/`) — S3 SDK installed but not configured |

---

## Architecture

### Single Brain Model
- **Drew** = the sole AI brain. Every message in every channel routes through Drew
- Drew uses **Claude CLI/SDK (OAuth)** — no API key needed, uses user's Claude account
- Anthropic API key is optional backup-backup (configurable in Settings for new users)
- Workers (Brian, Lisa, Vera) are internal agents — LM Studio locally, configurable fallback to Sonnet/Gemini/OpenAI
- LLM routing: **Claude CLI (primary) → Anthropic API (backup, if configured)**

### Three-Panel Layout (v2)
```
┌──────────┬──────────────┬─────────────────────────────────┐
│ Icon Bar │  Secondary   │                                 │
│  (64px)  │   Sidebar    │        Main Content             │
│          │   (260px)    │                                 │
│  Logo    │              │                                 │
│  ------  │  #general    │   Dashboard / Ask / Projects    │
│  Dash    │  #code       │   Lab / Calendar / Files        │
│  Ask     │  #marketing  │   Contacts / Admin / Settings   │
│  Lab     │              │                                 │
│  Proj    │  DMs         │                                 │
│  Cal     │  @drew       │                                 │
│  Files   │  @sarah      │                                 │
│  People  │              │                                 │
│  ------  │  Online (2)  │                                 │
│  Admin   │              │                                 │
│  Gear    │              │                                 │
│  Avatar  │  [user foot] │                                 │
└──────────┴──────────────┴─────────────────────────────────┘
```

### View Modes
| View | Description |
|------|-------------|
| **Dashboard** | Greeting, voice bar, today's meetings/tasks/follow-ups, pending approvals |
| **Ask** | Primary AI chat — greeting with quick prompts, threaded messages, markdown rendering |
| **Lab** | Prompt sandbox, skill editor, spawn tester — compare LLM providers side by side |
| **Projects** | Per-channel view with tabs: Messages, Board, Files |
| **Calendar** | Week view, event types (meeting/call/reminder/deadline/focus/personal), drag-to-create |
| **Files** | File browser with drag-and-drop upload |
| **Contacts** | CRM — contact cards, interaction timeline, call transcripts, recap generation |
| **Settings** | Global + per-project LLM provider config |
| **Office** | Worker floor, memory explorer, workflow monitor |
| **Admin** | Users, workspaces, usage, audit log, system health |

### Mobile (< 768px)
- Bottom nav: Home, Ask, Projects, Contacts, More
- "More" slide-up sheet with remaining nav items
- Floating brain button (voice overlay)
- Safe area insets for notched devices

---

## Conversation Memory

Channels have a `memory_summary` column. When a thread exceeds 50 messages:
1. Older messages are summarized via Claude Sonnet (background, non-blocking)
2. Summary is stored on the channel record
3. Drew sees: `memory_summary` + last 50 messages = never forgets context
4. Summary incrementally updates as new messages arrive

---

## Code Channel

Channel with `project_type = 'code'` gets:
- A specialized system prompt (technical, concise, code-first)
- Terminal-style rendering (JetBrains Mono font for agent messages)
- Seeded by default as `#code`

---

## Auth System

- NextAuth v5 beta.30 with credentials provider
- JWT sessions (no database sessions)
- Edge-compatible middleware at `src/middleware.ts` (cookie check only, no Node imports)
- Invite-only — admin creates users with temp passwords
- Roles: admin, member, viewer
- Admin: `andrew@steadybase.io` / `SteadyAdmin2024`
- Password change: modal in sidebar + mobile More sheet

---

## Database Schema (PostgreSQL)

17 tables:

| Table | Purpose |
|-------|---------|
| `workspaces` | Multi-tenant workspace container |
| `channels` | Projects/channels (w/ is_dm, project_type, memory_summary) |
| `messages` | Chat messages (sender, sender_type, agent_id, reasoning) |
| `approvals` | Action approval cards tied to messages |
| `project_skills` | Per-project skill definitions (name, content, active toggle) |
| `project_files` | File metadata (path, s3_key, uploaded_by) |
| `project_tasks` | Kanban tasks (status: backlog/todo/in_progress/review/done) |
| `settings` | Global + project-scoped key-value settings |
| `workspace_members` | Org membership (admin/member/viewer) |
| `memory_entries` | The Office memory store (org/team/worker/session scopes) |
| `contacts` | CRM contacts (name, email, phone, company, channels, notes) |
| `contact_interactions` | Interaction timeline (email/call/sms/meeting/note) |
| `call_transcripts` | Call recordings, transcripts, AI recaps |
| `calendar_events` | Calendar (meeting/call/reminder/deadline/focus/personal) |
| `assistant_actions` | Drew's autonomous action queue (requires approval) |
| `users` | Auth users (email, password_hash, is_admin) |
| `audit_log` | Admin audit trail |
| `usage_log` | LLM token/message/API usage tracking |

---

## API Routes

All routes are Next.js App Router API routes at `src/app/api/`:

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/messages` | GET, POST | Chat messages — POST triggers Drew AI response |
| `/api/messages/stream` | GET (SSE) | Real-time message stream |
| `/api/channels` | GET, POST, PATCH, DELETE | Channel/project CRUD |
| `/api/dm` | GET, POST | Direct message channel creation |
| `/api/files` | GET, POST, DELETE | File metadata CRUD |
| `/api/files/upload` | POST | FormData file upload |
| `/api/contacts` | GET, POST | Contact CRUD |
| `/api/contacts/[id]` | GET, PATCH, DELETE | Single contact operations |
| `/api/calendar` | GET, POST | Calendar events |
| `/api/calendar/[id]` | PATCH, DELETE | Single event operations |
| `/api/projects/[id]/skills` | GET, POST | Project skill CRUD |
| `/api/projects/[id]/skills/[skillId]` | PATCH, DELETE | Single skill operations |
| `/api/projects/[id]/tasks` | GET, POST | Task CRUD |
| `/api/projects/[id]/tasks/[taskId]` | PATCH, DELETE | Single task operations |
| `/api/settings` | GET, PUT | Global settings |
| `/api/presence` | GET, POST | User online heartbeat |
| `/api/search` | GET | Global search (contacts, events, tasks, messages) |
| `/api/dashboard` | GET | Dashboard data aggregation |
| `/api/lab/run` | POST | Single LLM prompt test |
| `/api/lab/compare` | POST | Side-by-side LLM comparison |
| `/api/voice/transcribe` | POST | Whisper audio transcription |
| `/api/voice/tts` | POST | Text-to-speech |
| `/api/calls/[id]/recap` | POST | AI call recap generation |
| `/api/office/metrics` | GET | Worker metrics |
| `/api/office/memory` | GET, POST, DELETE | Memory CRUD |
| `/api/office/memory/compress` | POST | Memory compression |
| `/api/assistant/actions` | GET, PATCH | Drew's action queue |
| `/api/workspaces` | GET | Workspace list |
| `/api/admin/users` | GET, POST | User management |
| `/api/admin/users/[id]` | PATCH, DELETE | Single user operations |
| `/api/admin/audit` | GET | Audit log |
| `/api/admin/usage` | GET | Usage stats |
| `/api/admin/system` | GET | System health |
| `/api/account/password` | POST | Password change |
| `/api/approvals` | PATCH | Approve/reject actions |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | **Main UI** (~4600 lines) — all views in one component |
| `src/app/globals.css` | Theme: purple accent, Inter/JetBrains Mono, dark mode |
| `src/app/layout.tsx` | Root layout, metadata, providers |
| `src/app/login/page.tsx` | Login page |
| `src/app/providers.tsx` | NextAuth SessionProvider |
| `src/app/api/messages/route.ts` | Message handling, Drew routing, memory summarization |
| `src/lib/llm-router.ts` | Multi-LLM routing (CLI primary → Opus API → Sonnet fallback) |
| `src/lib/agents.ts` | Agent definitions (Drew, Brian, Lisa, Vera) |
| `src/lib/db.ts` | PostgreSQL connection pool |
| `src/lib/sse.ts` | Server-Sent Events broadcast |
| `src/lib/auth-helpers.ts` | requireAuth(), logAudit(), logUsage() |
| `src/lib/schema.sql` | Full database schema |
| `src/lib/migration.sql` | Idempotent ALTER TABLE migrations |
| `src/lib/seed-admin.ts` | Admin user + code channel seeding |
| `src/auth.ts` | NextAuth v5 config |
| `src/middleware.ts` | Edge-compatible auth middleware |
| `capacitor.config.ts` | iOS Capacitor config (remote server) |

---

## Environment Variables (.env.local)

```
DATABASE_URL=postgresql://localhost:5432/clawchat
NEXTAUTH_SECRET=<random-secret>
NEXTAUTH_URL=http://localhost:3000

# AI Providers
# Drew uses Claude CLI/SDK (OAuth) — no API key needed
# API key is optional backup (also configurable in Settings UI)
ANTHROPIC_API_KEY=<optional-backup>
OPENAI_API_KEY=<optional-for-voice>
GOOGLE_API_KEY=<optional>

# LM Studio (local models)
LM_STUDIO_URL=http://localhost:1234/v1
```

Production (.env.local on EC2):
```
DATABASE_URL=postgresql://clawchat:clawchat_prod_2026@localhost:5432/clawchat
NEXTAUTH_URL=https://app.steadybase.io
```

---

## Setup (from scratch)

```bash
git clone https://github.com/andrewcmcguire/clawchat.git
cd clawchat
npm install

# Create database
createdb clawchat
npm run setup-db        # Creates tables
npm run seed-admin      # Creates admin user + code channel

# Configure
cp .env.local.example .env.local
# Edit .env.local with your API keys

# Run
npm run dev             # http://localhost:3000
```

## Deploy to EC2

```bash
git push origin main
ssh -i ~/.ssh/steadybase-key.pem ubuntu@44.254.64.158
cd /var/www/clawchat
git pull origin main
npm run build
pm2 restart clawchat
```

## iOS App

```bash
npx cap sync ios
npx cap open ios        # Opens Xcode
# Archive → Submit to App Store
```

---

## Design Tokens

| Token | Value |
|-------|-------|
| Background | `#0a0a0b` |
| Surface | `#141416` |
| Sidebar | `#111114` |
| Border | `#1e1e22` |
| Accent (purple) | `#8b5cf6` |
| Accent hover | `#a78bfa` |
| Foreground | `#e4e4e7` |
| Muted | `#71717a` |
| Success | `#22c55e` |
| Warning | `#f59e0b` |
| Danger | `#ef4444` |
| Font UI | Inter |
| Font Code | JetBrains Mono |
