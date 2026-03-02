CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL DEFAULT 'SteadyChat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  project_type TEXT DEFAULT 'project',
  skills_context TEXT,
  status TEXT DEFAULT 'active',
  is_dm BOOLEAN DEFAULT false,
  dm_user1 TEXT,
  dm_user2 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  sender TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent')),
  agent_id TEXT,
  content TEXT NOT NULL,
  reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);

CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_skills (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_channel ON project_skills(channel_id);

CREATE TABLE IF NOT EXISTS project_files (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  s3_key TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_channel ON project_files(channel_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'todo', 'in_progress', 'review', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee TEXT,
  due_date DATE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_channel ON project_tasks(channel_id, status);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project')),
  scope_id TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, scope_id, key)
);

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

-- Users (auth)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'credentials',
  is_admin BOOLEAN DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT DEFAULT 'default',
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- Usage log
CREATE TABLE IF NOT EXISTS usage_log (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT DEFAULT 'default',
  user_email TEXT,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('llm_tokens','messages','api_calls','voice_minutes')),
  amount INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_type_date ON usage_log(usage_type, created_at DESC);

-- Seed data (basic — runs before migration, so only use base columns)
INSERT INTO workspaces (id, name) VALUES ('default', 'SteadyChat') ON CONFLICT DO NOTHING;
INSERT INTO channels (id, workspace_id, name, description) VALUES ('general', 'default', 'General', 'General workspace') ON CONFLICT DO NOTHING;
