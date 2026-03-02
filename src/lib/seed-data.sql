-- Seed data for SteadyChat Phase 3C+
-- All idempotent with ON CONFLICT DO NOTHING

-- Workspace member (Andrew as admin)
INSERT INTO workspace_members (workspace_id, email, name, role, status, joined_at)
VALUES ('default', 'andrew@steadybase.io', 'Andrew McGuire', 'admin', 'active', NOW())
ON CONFLICT (workspace_id, email) DO NOTHING;

-- Contacts (~10)
INSERT INTO contacts (workspace_id, name, email, phone, company, role, linkedin_url, channels, notes, last_contacted_at) VALUES
  ('default', 'Sarah Kim', 'sarah@acmecorp.com', '+1-415-555-0101', 'Acme Corp', 'VP Engineering', 'https://linkedin.com/in/sarahkim', '{"email": true, "phone": true, "sms": true}', 'Key decision maker for enterprise deal. Prefers concise communication.', NOW() - INTERVAL '1 day'),
  ('default', 'Marcus Chen', 'marcus@techflow.io', '+1-650-555-0202', 'TechFlow', 'CTO', 'https://linkedin.com/in/marcuschen', '{"email": true, "phone": true, "linkedin": true}', 'Met at SaaS Connect. Interested in API integration.', NOW() - INTERVAL '4 days'),
  ('default', 'Elena Rodriguez', 'elena@brightpath.co', '+1-212-555-0303', 'BrightPath', 'Head of Product', NULL, '{"email": true, "sms": true}', 'Evaluating us vs competitor. Needs custom demo.', NOW() - INTERVAL '2 days'),
  ('default', 'James Morrison', 'james@globalretail.com', '+1-312-555-0404', 'Global Retail Inc', 'Director of Operations', 'https://linkedin.com/in/jamesmorrison', '{"email": true, "phone": true}', 'Large enterprise account. 500+ seat potential.', NOW() - INTERVAL '7 days'),
  ('default', 'Priya Patel', 'priya@innovateai.dev', '+1-408-555-0505', 'InnovateAI', 'CEO', 'https://linkedin.com/in/priyapatel', '{"email": true, "phone": true, "sms": true, "linkedin": true}', 'Strategic partner potential. Exploring joint venture.', NOW() - INTERVAL '3 days'),
  ('default', 'David Thompson', 'david@coastventures.com', '+1-310-555-0606', 'Coast Ventures', 'Managing Partner', NULL, '{"email": true, "phone": true}', 'Potential investor. Series A interest.', NOW() - INTERVAL '10 days'),
  ('default', 'Lisa Wang', 'lisa@nextstep.io', '+1-206-555-0707', 'NextStep', 'Engineering Manager', 'https://linkedin.com/in/lisawang', '{"email": true, "sms": true}', 'Technical evaluator. Needs sandbox access.', NOW() - INTERVAL '5 days'),
  ('default', 'Robert Garcia', 'robert@cloudscale.com', NULL, 'CloudScale', 'Solutions Architect', 'https://linkedin.com/in/robertgarcia', '{"email": true, "linkedin": true}', 'Integration partner. Working on connector.', NOW() - INTERVAL '2 days'),
  ('default', 'Amy Foster', 'amy@designhub.co', '+1-503-555-0909', 'DesignHub', 'Creative Director', NULL, '{"email": true, "phone": true}', 'Branding consultation. Redesign project.', NOW() - INTERVAL '14 days'),
  ('default', 'Tom Bradley', 'tom@steadybase.io', '+1-415-555-1010', 'SteadyBase', 'Co-founder', NULL, '{"email": true, "phone": true, "sms": true}', 'Internal. Co-founder and technical lead.', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- Contact interactions (~15, mix of human and assistant-initiated)
INSERT INTO contact_interactions (contact_id, type, summary, initiated_by, created_at) VALUES
  (1, 'email', 'Sent pricing proposal for enterprise tier', 'human', NOW() - INTERVAL '1 day'),
  (1, 'call', 'Discussed implementation timeline and technical requirements', 'human', NOW() - INTERVAL '3 days'),
  (1, 'email', 'Followed up on proposal with updated pricing', 'assistant', NOW() - INTERVAL '12 hours'),
  (2, 'meeting', 'Product demo with engineering team. Strong interest in API.', 'human', NOW() - INTERVAL '4 days'),
  (2, 'email', 'Sent API documentation and sandbox credentials', 'assistant', NOW() - INTERVAL '3 days'),
  (3, 'call', 'Discovery call. Needs custom reporting features.', 'human', NOW() - INTERVAL '2 days'),
  (3, 'sms', 'Confirmed meeting for Thursday demo', 'assistant', NOW() - INTERVAL '1 day'),
  (4, 'email', 'Initial outreach about enterprise plan', 'human', NOW() - INTERVAL '7 days'),
  (4, 'note', 'Decision pending Q2 budget approval', 'human', NOW() - INTERVAL '5 days'),
  (5, 'meeting', 'Partnership exploration meeting. Discussed integration opportunities.', 'human', NOW() - INTERVAL '3 days'),
  (5, 'email', 'Sent partnership proposal document', 'assistant', NOW() - INTERVAL '2 days'),
  (6, 'call', 'Investor intro call. Positive on traction metrics.', 'human', NOW() - INTERVAL '10 days'),
  (7, 'email', 'Sent technical architecture overview', 'human', NOW() - INTERVAL '5 days'),
  (8, 'message', 'Slack thread about connector API specs', 'human', NOW() - INTERVAL '2 days'),
  (9, 'meeting', 'Branding kickoff meeting', 'human', NOW() - INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- Call transcripts (~5)
INSERT INTO call_transcripts (workspace_id, contact_id, title, duration_seconds, transcript, recap, action_items, call_type, status, assistant_joined, assistant_notes, created_at) VALUES
  ('default', 1, 'Sarah Kim - Enterprise Pricing Discussion', 1847, 'Andrew: Hi Sarah, thanks for jumping on.\nSarah: Of course. We reviewed the proposal and have a few questions about the enterprise tier pricing.\nAndrew: Sure, happy to walk through it.\nSarah: The per-seat model works, but we need flexibility on the API call limits.\nAndrew: We can definitely customize that. What volume are you looking at?\nSarah: Roughly 500k calls per month to start, scaling to 2M.\nAndrew: That fits our growth plan perfectly. Let me put together a custom quote.', 'Discussed enterprise pricing with Sarah Kim. Key points: (1) Per-seat model accepted, (2) Need custom API call limits (500k-2M/month), (3) Will prepare custom quote. Next step: Send revised proposal by Friday.', '[{"task": "Prepare custom quote for Acme Corp", "due": "Friday"}, {"task": "Update pricing sheet with volume tiers", "due": "Next week"}]', 'outbound', 'completed', false, NULL, NOW() - INTERVAL '3 days'),
  ('default', 3, 'Elena Rodriguez - Discovery Call', 2156, 'Andrew: Elena, great to connect.\nElena: Thanks Andrew. We are evaluating three platforms and yours is on the shortlist.\nAndrew: That is great to hear. What are your main evaluation criteria?\nElena: Custom reporting is the big one. We need dashboards our C-suite can use.\nAndrew: Absolutely. We have a dashboard builder that might be exactly what you need.', NULL, '[]', 'inbound', 'completed', false, NULL, NOW() - INTERVAL '2 days'),
  ('default', 5, 'Priya Patel - Partnership Exploration', 3420, 'Andrew: Priya, excited about the partnership possibilities.\nPriya: Same here. Our AI models could really benefit from your workflow infrastructure.\nAndrew: The Temporal backbone gives us durability that most platforms lack.\nPriya: That is exactly what we need. Let us explore a joint product.', 'Explored partnership with InnovateAI. Strong alignment on AI + workflow infrastructure. Agreed to draft a joint product concept. Priya will loop in her engineering lead next week.', '[{"task": "Draft joint product concept doc", "due": "Next Monday"}, {"task": "Schedule follow-up with Priya + eng lead", "due": "Next week"}]', 'meeting', 'completed', true, 'Drew joined the call and took notes on technical integration points. Flagged compatibility considerations for Temporal workflow integration with InnovateAI models.', NOW() - INTERVAL '3 days'),
  ('default', 6, 'David Thompson - Investor Intro', 1523, 'Andrew: David, appreciate you taking the time.\nDavid: Happy to chat. Your traction numbers caught my eye.\nAndrew: We have been growing 40% month over month with strong retention.', NULL, '[]', 'outbound', 'completed', false, NULL, NOW() - INTERVAL '10 days'),
  ('default', 2, 'Marcus Chen - API Deep Dive', 945, NULL, NULL, '[]', 'outbound', 'scheduled', false, NULL, NOW() + INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- Calendar events (~8 for this week)
INSERT INTO calendar_events (workspace_id, title, description, start_time, end_time, event_type, calendar_type, contact_id, location, assistant_prep, created_by, created_at) VALUES
  ('default', 'Team Standup', 'Daily sync with engineering team', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 day 9 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 day 9 hours 30 minutes', 'meeting', 'business', NULL, 'Zoom', NULL, 'human', NOW() - INTERVAL '30 days'),
  ('default', 'Elena Rodriguez - Product Demo', 'Custom demo focusing on reporting features', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 day 14 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 day 15 hours', 'meeting', 'business', 3, 'Google Meet', 'Elena is evaluating 3 platforms. Key differentiator: custom dashboards for C-suite. Prepare live demo of dashboard builder. She asked about export formats last call.', 'human', NOW() - INTERVAL '3 days'),
  ('default', 'Marcus Chen - API Deep Dive', 'Technical session on API integration', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '2 days 11 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '2 days 12 hours', 'call', 'business', 2, NULL, NULL, 'human', NOW() - INTERVAL '5 days'),
  ('default', 'Send Acme Proposal', 'Revised pricing proposal for Sarah Kim', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '2 days 16 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '2 days 16 hours 30 minutes', 'deadline', 'business', 1, NULL, NULL, 'assistant', NOW() - INTERVAL '2 days'),
  ('default', 'Focus: Product Roadmap', 'Deep work block for Q2 roadmap planning', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '3 days 9 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '3 days 12 hours', 'focus', 'business', NULL, NULL, NULL, 'human', NOW() - INTERVAL '7 days'),
  ('default', 'Priya Patel - Follow Up', 'Review joint product concept with engineering', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '3 days 15 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '3 days 16 hours', 'meeting', 'business', 5, 'Zoom', NULL, 'assistant', NOW() - INTERVAL '1 day'),
  ('default', 'Gym', 'Workout session', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '4 days 7 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '4 days 8 hours', 'personal', 'personal', NULL, 'Equinox SOMA', NULL, 'human', NOW() - INTERVAL '14 days'),
  ('default', 'Board Meeting Prep', 'Prepare slides and metrics for board update', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '4 days 10 hours', DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '4 days 11 hours 30 minutes', 'meeting', 'business', NULL, 'Office', NULL, 'human', NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- Memory entries (~12 across scopes)
INSERT INTO memory_entries (workspace_id, scope, scope_id, key, value, pinned, version) VALUES
  ('default', 'org', 'default', 'company_context', 'SteadyBase builds AI-powered workflow automation. Primary product is SteadyChat, a digital executive assistant. Target market: SMB founders and executives. Key differentiator: Temporal-backed durable execution.', true, 3),
  ('default', 'org', 'default', 'brand_voice', 'Professional but approachable. Direct, not verbose. Data-driven. Avoid jargon unless talking to technical audience.', true, 1),
  ('default', 'org', 'default', 'pricing_tiers', 'Free: 1 workspace, 100 messages/day. Pro ($29/mo): unlimited messages, 5 workspaces. Enterprise (custom): unlimited everything, dedicated support, SLA.', false, 2),
  ('default', 'org', 'default', 'competitors', 'Main competitors: Lindy.ai (consumer assistant), Relevance.ai (workflow builder), Dust.tt (knowledge assistant). Our edge: durable execution via Temporal, voice-first.', false, 1),
  ('default', 'worker', 'drew', 'personality', 'Drew is direct, efficient, and proactive. Anticipates needs. Provides options rather than asking for permission on routine tasks. Flags decisions that need human judgment.', true, 2),
  ('default', 'worker', 'drew', 'communication_style', 'Andrew prefers brief, structured responses. Bullet points over paragraphs. Include action items at the end. Morning briefings should be under 200 words.', true, 1),
  ('default', 'worker', 'drew', 'learned_preferences', 'Andrew starts work around 8am PST. Prefers meetings after 10am. Does not like back-to-back meetings. Gym on Thursday mornings. Prefers Zoom for external, Meet for internal.', false, 4),
  ('default', 'team', 'sales', 'pipeline_rules', 'Qualify leads within 24h of inbound. Follow up within 3 business days of last contact. Proposals need 48h review before sending. All deals over $50k need co-founder approval.', true, 1),
  ('default', 'team', 'sales', 'deal_stages', 'Lead > Qualified > Discovery > Proposal > Negotiation > Closed Won/Lost. Average cycle: 45 days for mid-market, 90 days for enterprise.', false, 1),
  ('default', 'session', 'latest', 'last_briefing', 'Morning briefing delivered at 8:15am. 3 meetings today, 5 priority tasks, 2 follow-ups needed. Sarah Kim proposal is highest priority.', false, 1),
  ('default', 'session', 'latest', 'active_deals', 'Acme Corp ($120k, Proposal stage), TechFlow ($45k, Discovery), BrightPath ($30k, Discovery), Global Retail ($200k, Lead).', false, 2),
  ('default', 'worker', 'drew', 'tools_available', 'Email (pending SMTP setup), Calendar (local DB), Phone (pending Telnyx), SMS (pending Telnyx), Research (web search pending), Task management (active).', false, 1)
ON CONFLICT (workspace_id, scope, scope_id, key) DO NOTHING;

-- Projects (channels for workspace) — real projects
INSERT INTO channels (id, workspace_id, name, description, is_dm) VALUES
  ('steadybase-v2', 'default', 'Steadybase V2', 'Rebuild the UI to match mockups. Replace Slack tonight.', false),
  ('sales-pipeline', 'default', 'Sales Pipeline', 'Track deals, proposals, and revenue targets.', false),
  ('content-marketing', 'default', 'Content & Marketing', 'Brand voice, content calendar, and campaign tracking.', false),
  ('qa-testing', 'default', 'QA & Testing', 'Quality assurance, test plans, and bug tracking.', false)
ON CONFLICT (id) DO NOTHING;

-- Tasks for steadybase-v2
INSERT INTO project_tasks (channel_id, title, description, status, priority, assignee, due_date) VALUES
  ('steadybase-v2', 'Rebuild sidebar to match mockup', 'Replace icon bar + secondary sidebar with single Slack-style sidebar', 'done', 'urgent', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Add hash-based URL routing', 'Read/write window.location.hash for all views', 'done', 'high', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Dashboard KPI cards', 'Add LLM Costs, Projects, Workers, Due cards to dashboard', 'done', 'high', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Build Inbox view', 'Cross-project task aggregation with CRITICAL/INBOX/TODAY/LATER sections', 'done', 'high', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Build Activity view', 'Chronological feed with filter tabs', 'done', 'medium', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Build Finance view', 'LLM cost tracking by model, project, period', 'done', 'medium', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Settings Connectors page', 'Google Drive, Gmail, Calendar connect buttons', 'done', 'medium', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Deploy to AWS', 'Push, build, PM2 restart on EC2', 'todo', 'urgent', 'Andrew', CURRENT_DATE),
  ('steadybase-v2', 'Wire Vapi voice assistant', 'Floating brain button triggers real-time voice with Drew', 'backlog', 'medium', NULL, CURRENT_DATE + INTERVAL '3 days'),
  ('steadybase-v2', 'Recall.ai meeting transcription', 'Auto-join meetings and transcribe', 'backlog', 'low', NULL, CURRENT_DATE + INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- Tasks for sales-pipeline
INSERT INTO project_tasks (channel_id, title, description, status, priority, assignee, due_date) VALUES
  ('sales-pipeline', 'Send Acme Corp proposal', 'Custom pricing for 500k-2M API calls/month', 'todo', 'urgent', 'Andrew', CURRENT_DATE + INTERVAL '1 day'),
  ('sales-pipeline', 'Schedule demo for Elena Rodriguez', 'BrightPath needs custom reporting demo', 'todo', 'high', 'Andrew', CURRENT_DATE + INTERVAL '2 days'),
  ('sales-pipeline', 'Follow up with James Morrison', 'Check Q2 budget approval status at Global Retail', 'todo', 'high', 'Drew', CURRENT_DATE),
  ('sales-pipeline', 'Update pricing tiers', 'Add volume-based pricing for enterprise', 'backlog', 'medium', NULL, CURRENT_DATE + INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- Tasks for content-marketing
INSERT INTO project_tasks (channel_id, title, description, status, priority, assignee, due_date) VALUES
  ('content-marketing', 'Write launch announcement', 'Blog post for Steadybase v2 launch', 'todo', 'high', 'Andrew', CURRENT_DATE + INTERVAL '3 days'),
  ('content-marketing', 'Create demo video', 'Screen recording of new dashboard + sidebar', 'backlog', 'medium', NULL, CURRENT_DATE + INTERVAL '5 days'),
  ('content-marketing', 'Update docs site', 'docs.steadybase.io needs new screenshots', 'backlog', 'low', NULL, CURRENT_DATE + INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- Skills for projects
INSERT INTO project_skills (channel_id, name, content, active) VALUES
  ('qa-testing', 'QA Expert', 'You are a meticulous QA expert. Test every view, button, and interaction. Report bugs with exact steps to reproduce. Check mobile responsiveness. Verify data loads correctly from APIs.', true),
  ('sales-pipeline', 'Sales Process', 'Follow the deal stages: Lead > Qualified > Discovery > Proposal > Negotiation > Closed. Qualify leads within 24h. Follow up within 3 business days. All deals over $50k need co-founder approval.', true),
  ('content-marketing', 'Brand Voice', 'SteadyBase voice: Professional but approachable. Direct, not verbose. Data-driven. Use clear headings, bullet points, and action items. Avoid jargon unless speaking to technical audience.', true)
ON CONFLICT DO NOTHING;

-- Assistant actions (~3)
INSERT INTO assistant_actions (workspace_id, action_type, status, title, description, target_contact_id, requires_approval, scheduled_for, created_at) VALUES
  ('default', 'email', 'pending', 'Send follow-up email to Sarah Kim about pricing', 'Draft and send updated pricing proposal based on the 500k-2M API calls/month discussion. Include custom volume tiers.', 1, true, NOW() + INTERVAL '2 hours', NOW() - INTERVAL '6 hours'),
  ('default', 'follow_up', 'completed', 'Follow up with Marcus Chen on API docs', 'Sent API documentation and sandbox access credentials to Marcus Chen at TechFlow.', 2, false, NULL, NOW() - INTERVAL '3 days'),
  ('default', 'call', 'pending', 'Schedule call with James Morrison', 'Reach out to James Morrison at Global Retail to check on Q2 budget approval status. Has been 7 days since last contact.', 4, true, NOW() + INTERVAL '1 day', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;
