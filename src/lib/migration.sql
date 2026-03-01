-- Migration: Add workspace org fields, members, memory, contacts, calls, calendar, assistant actions
-- All statements are idempotent (safe to re-run)

-- Alter workspaces for org model
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- Alter channels for project fields
ALTER TABLE channels ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'project';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS skills_context TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Workspace members (org-based)
CREATE TABLE IF NOT EXISTS workspace_members (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','deactivated')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  UNIQUE (workspace_id, email)
);

-- Memory entries for The Office
CREATE TABLE IF NOT EXISTS memory_entries (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
  scope TEXT NOT NULL CHECK (scope IN ('org','team','worker','session')),
  scope_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  pinned BOOLEAN DEFAULT false,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, scope, scope_id, key)
);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  role TEXT,
  linkedin_url TEXT,
  channels JSONB DEFAULT '{}',
  notes TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Contact interactions timeline
CREATE TABLE IF NOT EXISTS contact_interactions (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('email','call','sms','meeting','note','message')),
  summary TEXT NOT NULL,
  transcript_id INTEGER,
  channel_id TEXT,
  initiated_by TEXT DEFAULT 'human' CHECK (initiated_by IN ('human','assistant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Call transcripts
CREATE TABLE IF NOT EXISTS call_transcripts (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
  contact_id INTEGER REFERENCES contacts(id),
  channel_id TEXT,
  title TEXT NOT NULL,
  duration_seconds INTEGER,
  recording_url TEXT,
  transcript TEXT,
  recap TEXT,
  action_items JSONB DEFAULT '[]',
  call_type TEXT DEFAULT 'outbound' CHECK (call_type IN ('inbound','outbound','meeting')),
  status TEXT DEFAULT 'completed' CHECK (status IN ('scheduled','ringing','in_progress','processing','completed','failed')),
  assistant_joined BOOLEAN DEFAULT false,
  assistant_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  event_type TEXT DEFAULT 'meeting' CHECK (event_type IN ('meeting','call','reminder','deadline','focus','personal')),
  calendar_type TEXT DEFAULT 'business' CHECK (calendar_type IN ('business','personal')),
  contact_id INTEGER REFERENCES contacts(id),
  channel_id TEXT,
  location TEXT,
  color TEXT,
  assistant_prep TEXT,
  created_by TEXT DEFAULT 'human' CHECK (created_by IN ('human','assistant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Assistant action queue (Drew's autonomous tasks)
CREATE TABLE IF NOT EXISTS assistant_actions (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('email','call','sms','calendar','task','research','follow_up')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','in_progress','completed','failed','cancelled')),
  title TEXT NOT NULL,
  description TEXT,
  target_contact_id INTEGER REFERENCES contacts(id),
  channel_id TEXT,
  payload JSONB DEFAULT '{}',
  requires_approval BOOLEAN DEFAULT true,
  scheduled_for TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
