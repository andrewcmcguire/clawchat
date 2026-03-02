# Steadybase v2 — Build Progress

> If Claude crashes, paste this file's path and say "resume from BUILD-PROGRESS.md"

## Status: PHASES 1-4 COMPLETE, READY TO DEPLOY
**Started:** 2026-03-01
**Last Updated:** Phase 4 complete, build passing

## Phase 1: Fix Drew API Key — DONE (with workaround)
- [x] API key is expired (OAuth token sk-ant-oat01-... returns 401)
- [x] Added fallback chain in llm-router.ts: Opus → Sonnet → CLI
- [ ] **USER ACTION NEEDED:** Get fresh API key from console.anthropic.com
- [ ] Update .env.local on both local and EC2

## Phase 2: UI Redesign — DONE
- [x] globals.css: Purple accent (#8b5cf6), Inter + JetBrains Mono fonts, #0a0a0b bg
- [x] layout.tsx: Updated theme color, fonts via Google Fonts import in CSS
- [x] page.tsx: Three-panel layout (icon bar | secondary sidebar | main)
- [x] page.tsx: New nav items — Dashboard, Ask, Lab, Projects, Calendar, Files, Contacts
- [x] page.tsx: DMs + Channels in secondary sidebar
- [x] page.tsx: Ask page — greeting with quick prompts, threaded chat, clean input
- [x] page.tsx: Projects tab bar (Messages, Board, Files)
- [x] page.tsx: Cards, status badges, hover states via CSS classes
- [x] Mobile: Updated bottom nav (Home, Ask, Projects, Contacts, More)
- [x] agents.ts: Drew color updated to purple

## Phase 3: Conversation Memory — DONE
- [x] migration.sql: Added memory_summary + summary_updated_at to channels
- [x] Local DB migrated (ALTER TABLE ran)
- [x] messages/route.ts: summarizeAndStore() function
- [x] When thread > 50 messages, older ones get summarized via Claude Sonnet
- [x] Drew sees summary + last 50 messages — never forgets

## Phase 4: Code Channel — DONE
- [x] seed-admin.ts: Seeds 'code' channel with project_type='code'
- [x] Local DB seeded (INSERT ran)
- [x] messages/route.ts: CODE_SYSTEM_PROMPT for code channels
- [x] page.tsx: Terminal-style rendering (font-mono) for code channel agent messages
- [x] Code channel appears in sidebar as #code

## Phase 5: Deploy to AWS — NOT STARTED
- [ ] `git add . && git commit`
- [ ] `git push origin main`
- [ ] SSH to EC2 (44.254.64.158): `cd /var/www/clawchat && git pull`
- [ ] Run migration: `psql -c "ALTER TABLE channels ADD COLUMN IF NOT EXISTS memory_summary TEXT; ALTER TABLE channels ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ;"`
- [ ] Seed code channel: `psql -c "INSERT INTO channels (id, workspace_id, name, description, project_type) VALUES ('code', 'default', 'Code', 'Terminal-style coding channel', 'code') ON CONFLICT (id) DO UPDATE SET project_type = 'code';"`
- [ ] `npm run build && pm2 restart clawchat`
- [ ] Update ANTHROPIC_API_KEY in .env.local on EC2

## Phase 6: iOS App — NOT STARTED
- [ ] npx cap sync ios
- [ ] Open in Xcode, verify builds
- [ ] Ready for user to archive + submit

## Files Modified
| File | Change |
|------|--------|
| src/app/globals.css | Full theme: purple accent, new fonts, card/badge/icon-btn classes |
| src/app/layout.tsx | Updated theme color, simplified |
| src/app/page.tsx | Three-panel layout, Ask/Projects views, code channel rendering |
| src/lib/agents.ts | Drew color → #8b5cf6 |
| src/lib/llm-router.ts | Opus → Sonnet → CLI fallback chain |
| src/app/api/messages/route.ts | Memory summaries, code channel routing, 50-msg context |
| src/lib/migration.sql | memory_summary + summary_updated_at columns |
| src/lib/schema.sql | memory_summary + summary_updated_at in schema |
| src/lib/seed-admin.ts | Code channel seeding |

## Known Issues
- ANTHROPIC_API_KEY OAuth token expired — need fresh key
- On EC2, need to run migration SQL before the new build
