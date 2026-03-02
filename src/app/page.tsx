"use client";

import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { useSession, signOut } from "next-auth/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

// ─── Types ───────────────────────────────────────────────────────────
interface Message {
  id: number;
  channel_id: string;
  sender: string;
  sender_type: "human" | "agent";
  agent_id: string | null;
  content: string;
  reasoning: string | null;
  created_at: string;
  approval_id: number | null;
  approval_title: string | null;
  approval_description: string | null;
  approval_status: "pending" | "approved" | "rejected" | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  project_type?: string;
  status?: string;
  is_dm?: boolean;
  dm_user1?: string;
  dm_user2?: string;
}

interface Skill {
  id: number;
  channel_id: string;
  name: string;
  content: string;
  file_name: string | null;
  file_type: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface ProjectTask {
  id: number;
  channel_id: string;
  title: string;
  description: string | null;
  status: "backlog" | "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  assignee: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

type ViewMode = "dashboard" | "chat" | "board" | "settings" | "office" | "lab" | "contacts" | "calendar" | "files" | "admin";

interface Contact { id: number; name: string; email: string | null; phone: string | null; company: string | null; role: string | null; linkedin_url: string | null; channels: Record<string, boolean>; notes: string | null; last_contacted_at: string | null; }
interface ContactInteraction { id: number; type: string; summary: string; transcript_id: number | null; initiated_by: string; created_at: string; }
interface CallTranscript { id: number; contact_id: number | null; title: string; duration_seconds: number | null; transcript: string | null; recap: string | null; status: string; assistant_joined: boolean; created_at: string; }
interface CalendarEvent { id: number; title: string; description: string | null; start_time: string; end_time: string; event_type: string; calendar_type: string; contact_id: number | null; contact_name: string | null; channel_id: string | null; location: string | null; assistant_prep: string | null; created_by: string; }
interface MemoryEntry { id: number; scope: string; scope_id: string; key: string; value: string; pinned: boolean; version: number; updated_at: string; }
interface MemoryHealth { total: number; pinned: number; stalePercent: number; compressionRatio: number; }
interface AssistantAction { id: number; action_type: string; status: string; title: string; description: string | null; target_contact_id: number | null; contact_name: string | null; requires_approval: boolean; scheduled_for: string | null; created_at: string; }
interface DashboardData { events: CalendarEvent[]; tasks: (ProjectTask & { project_name?: string })[]; activity: ActivityEntry[]; followUps: Contact[]; pendingActions: AssistantAction[]; summary: { meetingCount: number; taskCount: number; followUpCount: number; pendingActionCount: number; }; }
interface Workspace { id: string; name: string; description: string | null; member_count: number; }

const EVENT_TYPE_COLORS: Record<string, string> = { meeting: "#6366f1", call: "#22c55e", reminder: "#f59e0b", deadline: "#ef4444", focus: "#3b82f6", personal: "#71717a" };

function getMonday(d: Date): Date { const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); return new Date(d.getFullYear(), d.getMonth(), diff); }

function formatDateShort(dateStr: string): string { return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric" }); }

function formatTimeRange(start: string, end: string): string {
  const s = new Date(start); const e = new Date(end);
  return `${s.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${e.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

interface OfficeMetrics {
  activeWorkers: number;
  tasksCompleted: number;
  estimatedTokens: number;
  estimatedCost: string;
  memoryHealth: number;
  messagesToday: number;
}

interface ActivityEntry {
  type: "message" | "approval" | "task";
  id: number;
  actor: string;
  description: string;
  project_name: string;
  created_at: string;
}

interface LabResult {
  text: string;
  provider: string;
  latency: number;
  inputTokens: number;
  outputTokens: number;
  cost: string;
  error?: string;
}

const BOARD_COLUMNS: { key: ProjectTask["status"]; label: string; color: string }[] = [
  { key: "backlog", label: "Backlog", color: "#71717a" },
  { key: "todo", label: "To Do", color: "#3b82f6" },
  { key: "in_progress", label: "In Progress", color: "#f59e0b" },
  { key: "review", label: "Review", color: "#8b5cf6" },
  { key: "done", label: "Done", color: "#22c55e" },
];

const PRIORITY_COLORS: Record<string, string> = {
  low: "#71717a",
  medium: "#3b82f6",
  high: "#f59e0b",
  urgent: "#ef4444",
};

// ─── Constants ───────────────────────────────────────────────────────
const drewMeta = { color: "#00d4a8", role: "Brain", avatar: "D" };

// ─── Helpers ─────────────────────────────────────────────────────────
function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function shouldGroup(prev: Message | null, curr: Message): boolean {
  if (!prev) return false;
  if (prev.sender !== curr.sender) return false;
  const diff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
  return diff < 5 * 60 * 1000;
}

function isDifferentDay(a: string, b: string): boolean {
  return new Date(a).toDateString() !== new Date(b).toDateString();
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────
export default function Home() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typingAgent, setTypingAgent] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState("general");
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(typeof window !== "undefined" ? window.innerWidth >= 768 : true);
  const [hoveredMsg, setHoveredMsg] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [playingTTS, setPlayingTTS] = useState<number | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillContent, setNewSkillContent] = useState("");
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<ProjectTask["priority"]>("medium");
  const [newTaskStatus, setNewTaskStatus] = useState<ProjectTask["status"]>("backlog");
  const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  // Office state
  const [officeMetrics, setOfficeMetrics] = useState<OfficeMetrics>({ activeWorkers: 0, tasksCompleted: 0, estimatedTokens: 0, estimatedCost: "0.00", memoryHealth: 0, messagesToday: 0 });
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<"all" | "message" | "task" | "approval">("all");
  // Lab state
  const [labTab, setLabTab] = useState<"sandbox" | "skills" | "spawn">("sandbox");
  const [labSystemPrompt, setLabSystemPrompt] = useState("");
  const [labUserMessage, setLabUserMessage] = useState("");
  const [labProvider, setLabProvider] = useState<string>("claude-opus");
  const [labCompareMode, setLabCompareMode] = useState(false);
  const [labProviderB, setLabProviderB] = useState<string>("claude-sonnet");
  const [labRunning, setLabRunning] = useState(false);
  const [labResult, setLabResult] = useState<LabResult | null>(null);
  const [labResultB, setLabResultB] = useState<LabResult | null>(null);
  // Lab skill editor state
  const [labEditingSkill, setLabEditingSkill] = useState<Skill | null>(null);
  // Workspace
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState("default");
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);
  // Dashboard
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactDetail, setContactDetail] = useState<{ interactions: ContactInteraction[]; calls: CallTranscript[] } | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactCompany, setNewContactCompany] = useState("");
  const [newContactRole, setNewContactRole] = useState("");
  // Calendar
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(getMonday(new Date()));
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState<"all" | "business" | "personal">("all");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventStart, setNewEventStart] = useState("");
  const [newEventEnd, setNewEventEnd] = useState("");
  const [newEventType, setNewEventType] = useState("meeting");
  const [newEventCalType, setNewEventCalType] = useState("business");
  const [newEventDesc, setNewEventDesc] = useState("");
  const [newEventLocation, setNewEventLocation] = useState("");
  const [newEventContactId, setNewEventContactId] = useState<number | null>(null);
  // Office tabs
  const [officeTab, setOfficeTab] = useState<"floor" | "memory" | "workflows">("floor");
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryHealth, setMemoryHealth] = useState<MemoryHealth>({ total: 0, pinned: 0, stalePercent: 0, compressionRatio: 1 });
  const [selectedMemory, setSelectedMemory] = useState<MemoryEntry | null>(null);
  const [memoryFilter, setMemoryFilter] = useState<string>("all");
  const [showWriteMemory, setShowWriteMemory] = useState(false);
  const [newMemScope, setNewMemScope] = useState("worker");
  const [newMemKey, setNewMemKey] = useState("");
  const [newMemValue, setNewMemValue] = useState("");
  // Global search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ contacts: { id: number; name: string; email: string; company: string; role: string }[]; events: { id: number; title: string; start_time: string; event_type: string }[]; tasks: { id: number; title: string; status: string; priority: string; project_name: string }[]; messages: { id: number; sender: string; content: string; created_at: string; project_name: string }[] } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Pending action badge count
  const [pendingActionCount, setPendingActionCount] = useState(0);
  // Prep state
  const [preppingEventId, setPreppingEventId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Inline editing
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  // Call recap
  const [recappingCallId, setRecappingCallId] = useState<number | null>(null);
  // Drag and drop
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // Task editing
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  // Calendar event editing
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  // Toast notifications
  const [toasts, setToasts] = useState<{ id: number; message: string; type: "success" | "error" }[]>([]);
  // Project editing
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  // Admin state
  const [adminTab, setAdminTab] = useState<"users" | "workspaces" | "usage" | "audit" | "system">("users");
  const [adminUsers, setAdminUsers] = useState<{ id: number; email: string; name: string; role: string; status: string; is_admin: boolean; auth_provider: string; last_login_at: string | null; created_at: string }[]>([]);
  const [adminAudit, setAdminAudit] = useState<{ entries: { id: number; user_email: string; action: string; resource_type: string; resource_id: string | null; details: Record<string, unknown>; created_at: string }[]; total: number; page: number; totalPages: number }>({ entries: [], total: 0, page: 1, totalPages: 0 });
  const [adminUsage, setAdminUsage] = useState<{ totals24h: { usage_type: string; total: string }[]; daily: { day: string; usage_type: string; total: string }[]; byUser: { user_email: string; usage_type: string; total: string }[]; byModel: { model: string; total: string }[] } | null>(null);
  const [adminSystem, setAdminSystem] = useState<{ tableCounts: Record<string, number>; pool: Record<string, number>; server: { nodeVersion: string; uptime: number; memoryUsage: { heapUsed: number; heapTotal: number }; platform: string } } | null>(null);
  const [inviteForm, setInviteForm] = useState({ name: "", email: "", role: "member" });
  const [inviteResult, setInviteResult] = useState<{ email: string; temporaryPassword: string } | null>(null);
  // Files state
  const [projectFiles, setProjectFiles] = useState<{ id: number; channel_id: string; name: string; file_type: string; file_size: number; s3_key: string | null; uploaded_by: string | null; project_name: string; created_at: string }[]>([]);
  // Mobile state
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [brainOverlayOpen, setBrainOverlayOpen] = useState(false);
  // Emoji picker
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  // Audio note recording
  const [recordingAudioNote, setRecordingAudioNote] = useState(false);
  const [audioNoteBlob, setAudioNoteBlob] = useState<Blob | null>(null);
  const audioNoteRecorderRef = useRef<MediaRecorder | null>(null);
  const audioNoteChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [dragOverFiles, setDragOverFiles] = useState(false);
  // Password change
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", new: "", confirm: "" });
  const [passwordChanging, setPasswordChanging] = useState(false);
  // DM state
  const [dmUsers, setDmUsers] = useState<{ id: number; email: string; name: string }[]>([]);
  const [showNewDM, setShowNewDM] = useState(false);
  // Presence
  const [onlineUsers, setOnlineUsers] = useState<{ email: string; name: string }[]>([]);

  // Close sidebar on mobile when navigating
  function navTo(mode: ViewMode) {
    setViewMode(mode);
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  }

  // ─── Keyboard Shortcuts ────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K → toggle search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => {
          if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50);
          else { setSearchQuery(""); setSearchResults(null); }
          return !prev;
        });
        return;
      }
      // Escape → close search / close modals
      if (e.key === "Escape") {
        if (searchOpen) { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); return; }
        if (showAddEvent) { setShowAddEvent(false); return; }
        if (showAddContact) { setShowAddContact(false); return; }
        if (editingSkill) { setEditingSkill(null); return; }
        if (showAddSkill) { setShowAddSkill(false); return; }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, showAddEvent, showAddContact, editingSkill, showAddSkill]);

  // ─── Data Loading ────────────────────────────────────────────────
  const loadMessages = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/messages?channel_id=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/channels");
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data);
      }
    } catch {
      // API may not exist yet, use defaults
      setProjects([{ id: "general", name: "General", description: "General workspace" }]);
    }
  }, []);

  const loadSkills = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/skills`);
      const data = await res.json();
      if (Array.isArray(data)) setSkills(data);
    } catch {
      setSkills([]);
    }
  }, []);

  const loadTasks = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks`);
      const data = await res.json();
      if (Array.isArray(data)) setTasks(data);
    } catch {
      setTasks([]);
    }
  }, []);

  const loadGlobalSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data && typeof data === "object") setGlobalSettings(data);
    } catch {
      // settings not available yet
    }
  }, []);

  const loadOfficeMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/office/metrics");
      const data = await res.json();
      setOfficeMetrics(data);
    } catch { /* office metrics not available */ }
  }, []);

  const loadActivityFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/office/activity");
      const data = await res.json();
      if (Array.isArray(data)) setActivityFeed(data);
    } catch { /* activity not available */ }
  }, []);

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      const data = await res.json();
      if (Array.isArray(data)) setWorkspaces(data);
    } catch { setWorkspaces([{ id: "default", name: "SteadyChat", description: null, member_count: 1 }]); }
  }, []);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      const data = await res.json();
      setDashboardData(data);
    } catch { /* dashboard not available */ }
    finally { setDashboardLoading(false); }
  }, []);

  const loadContacts = useCallback(async (search?: string) => {
    try {
      const url = search ? `/api/contacts?search=${encodeURIComponent(search)}` : "/api/contacts";
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) setContacts(data);
    } catch { setContacts([]); }
  }, []);

  const loadContactDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/contacts/${id}`);
      const data = await res.json();
      setContactDetail({ interactions: data.interactions || [], calls: data.calls || [] });
    } catch { setContactDetail(null); }
  }, []);

  const loadCalendarEvents = useCallback(async (weekStart: Date) => {
    const start = weekStart.toISOString();
    const end = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const res = await fetch(`/api/calendar?start=${start}&end=${end}`);
      const data = await res.json();
      if (Array.isArray(data)) setCalendarEvents(data);
    } catch { setCalendarEvents([]); }
  }, []);

  const loadMemory = useCallback(async () => {
    try {
      const res = await fetch("/api/office/memory");
      const data = await res.json();
      if (data.entries) setMemoryEntries(data.entries);
      if (data.health) setMemoryHealth(data.health);
    } catch { /* memory not available */ }
  }, []);

  const loadPendingActionCount = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/actions?status=pending");
      const data = await res.json();
      if (Array.isArray(data)) setPendingActionCount(data.filter((a: AssistantAction) => a.requires_approval).length);
    } catch { /* no actions */ }
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setSearchResults(null); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch { setSearchResults(null); }
  }, []);

  async function prepEvent(eventId: number) {
    setPreppingEventId(eventId);
    try {
      const res = await fetch(`/api/calendar/${eventId}/prep`, { method: "POST" });
      const data = await res.json();
      if (data.prep && selectedEvent) {
        setSelectedEvent({ ...selectedEvent, assistant_prep: data.prep });
      }
      loadCalendarEvents(calendarWeekStart);
    } catch (err) { console.error("Prep failed:", err); }
    finally { setPreppingEventId(null); }
  }

  // Admin data loading
  const loadAdminUsers = useCallback(async () => {
    try { const res = await fetch("/api/admin/users"); if (res.ok) setAdminUsers(await res.json()); } catch {}
  }, []);
  const loadAdminAudit = useCallback(async (page = 1) => {
    try { const res = await fetch(`/api/admin/audit?page=${page}`); if (res.ok) setAdminAudit(await res.json()); } catch {}
  }, []);
  const loadAdminUsage = useCallback(async () => {
    try { const res = await fetch("/api/admin/usage"); if (res.ok) setAdminUsage(await res.json()); } catch {}
  }, []);
  const loadAdminSystem = useCallback(async () => {
    try { const res = await fetch("/api/admin/system"); if (res.ok) setAdminSystem(await res.json()); } catch {}
  }, []);
  // Files loading
  const loadFiles = useCallback(async (channelId?: string) => {
    try {
      const url = channelId ? `/api/files?channel_id=${encodeURIComponent(channelId)}` : "/api/files";
      const res = await fetch(url);
      if (res.ok) setProjectFiles(await res.json());
    } catch {}
  }, []);
  // Invite user
  async function handleInviteUser() {
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) return;
    try {
      const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inviteForm) });
      if (res.ok) {
        const data = await res.json();
        setInviteResult({ email: data.user.email, temporaryPassword: data.temporaryPassword });
        setInviteForm({ name: "", email: "", role: "member" });
        loadAdminUsers();
        showToast("User invited");
      } else {
        const err = await res.json();
        showToast(err.error || "Invite failed", "error");
      }
    } catch { showToast("Invite failed", "error"); }
  }
  // Delete/update admin user
  async function handleDeleteUser(id: number) {
    try { await fetch(`/api/admin/users/${id}`, { method: "DELETE" }); loadAdminUsers(); showToast("User deleted"); } catch {}
  }
  async function handleUpdateUserRole(id: number, role: string) {
    try { await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) }); loadAdminUsers(); showToast("Role updated"); } catch {}
  }
  // Delete file
  async function handleDeleteFile(id: number) {
    try { await fetch(`/api/files?id=${id}`, { method: "DELETE" }); loadFiles(); showToast("File deleted"); } catch {}
  }
  // Upload file
  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingFile(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("channel_id", activeProject);
        const res = await fetch("/api/files/upload", { method: "POST", body: fd });
        if (!res.ok) { const err = await res.json(); showToast(err.error || "Upload failed", "error"); continue; }
      }
      loadFiles();
      showToast(`${files.length} file${files.length > 1 ? "s" : ""} uploaded`);
    } catch { showToast("Upload failed", "error"); }
    finally { setUploadingFile(false); setDragOverFiles(false); }
  }
  // Password change
  async function handlePasswordChange() {
    if (passwordForm.new !== passwordForm.confirm) { showToast("Passwords don't match", "error"); return; }
    if (passwordForm.new.length < 8) { showToast("Password must be at least 8 characters", "error"); return; }
    setPasswordChanging(true);
    try {
      const res = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: passwordForm.current, newPassword: passwordForm.new }) });
      if (res.ok) { showToast("Password changed"); setShowPasswordChange(false); setPasswordForm({ current: "", new: "", confirm: "" }); }
      else { const err = await res.json(); showToast(err.error || "Failed", "error"); }
    } catch { showToast("Failed to change password", "error"); }
    finally { setPasswordChanging(false); }
  }
  // Load DM users
  const loadDMUsers = useCallback(async () => {
    try { const res = await fetch("/api/admin/users"); if (res.ok) setDmUsers(await res.json()); } catch {}
  }, []);

  useEffect(() => { loadProjects(); loadGlobalSettings(); loadWorkspaces(); loadPendingActionCount(); }, [loadProjects, loadGlobalSettings, loadWorkspaces, loadPendingActionCount]);
  useEffect(() => {
    loadMessages(activeProject);
    loadSkills(activeProject);
    loadTasks(activeProject);
  }, [activeProject, loadMessages, loadSkills, loadTasks]);

  // Load view-specific data
  useEffect(() => {
    if (viewMode === "office") { loadOfficeMetrics(); loadActivityFeed(); if (officeTab === "memory") loadMemory(); }
    if (viewMode === "dashboard") loadDashboard();
    if (viewMode === "contacts") loadContacts(contactSearch || undefined);
    if (viewMode === "calendar") loadCalendarEvents(calendarWeekStart);
    if (viewMode === "admin") { loadAdminUsers(); if (adminTab === "audit") loadAdminAudit(); if (adminTab === "usage") loadAdminUsage(); if (adminTab === "system") loadAdminSystem(); }
    if (viewMode === "files") loadFiles();
  }, [viewMode, loadOfficeMetrics, loadActivityFeed, loadDashboard, loadContacts, loadCalendarEvents, loadMemory, officeTab, contactSearch, calendarWeekStart, loadAdminUsers, loadAdminAudit, loadAdminUsage, loadAdminSystem, adminTab, loadFiles]);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // ─── SSE ─────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/messages/stream");
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "message") {
        setMessages((prev) => {
          if (data.message.channel_id !== activeProject) return prev;
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        // Browser notification for messages from others (when tab not focused)
        if (data.message.sender !== session?.user?.name && document.hidden) {
          try {
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`${data.message.sender}`, {
                body: data.message.content?.substring(0, 100),
                icon: "/icons/icon-192.svg",
                tag: `msg-${data.message.id}`,
              });
            }
          } catch {}
        }
      }
      if (data.type === "approval_update") {
        setMessages((prev) =>
          prev.map((m) =>
            m.approval_id === data.approval.id
              ? { ...m, approval_status: data.approval.status, resolved_by: data.approval.resolved_by, resolved_at: data.approval.resolved_at }
              : m
          )
        );
      }
      if (data.type === "typing") setTypingAgent(data.agent_name);
      if (data.type === "stop_typing") setTypingAgent(null);
      if (data.type === "project_created") loadProjects();
      if (data.type === "channel_created") loadProjects();
      if (data.type === "tasks_created") loadTasks(activeProject);

      // Live feed: append new events to activity feed
      if (data.type === "message" && data.message) {
        setActivityFeed((prev) => {
          const entry: ActivityEntry = {
            type: "message",
            id: data.message.id,
            actor: data.message.sender,
            description: `${data.message.sender} ${data.message.sender_type === "agent" ? "replied" : "sent a message"}`,
            project_name: "",
            created_at: data.message.created_at,
          };
          return [entry, ...prev].slice(0, 100);
        });
        // Refresh office metrics on new messages
        loadOfficeMetrics();
      }
      if (data.type === "tasks_created") {
        loadActivityFeed();
        loadOfficeMetrics();
      }
    };
    return () => es.close();
  }, [activeProject, loadProjects, loadOfficeMetrics, loadActivityFeed]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingAgent]);

  // ─── Presence heartbeat ────────────────────────────────────────
  useEffect(() => {
    async function heartbeat() {
      try {
        await fetch("/api/presence", { method: "POST" });
        const res = await fetch("/api/presence");
        if (res.ok) setOnlineUsers(await res.json());
      } catch {}
    }
    heartbeat();
    const interval = setInterval(heartbeat, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ─── Actions ─────────────────────────────────────────────────────
  async function handleSend(text?: string) {
    const content = (text || input).trim();
    if (!content || sending) return;
    if (!text) setInput("");
    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, channel_id: activeProject }),
      });
    } catch (err) { console.error("Failed to send:", err); }
    finally { setSending(false); inputRef.current?.focus(); }
  }

  async function handleApproval(id: number, status: "approved" | "rejected") {
    try {
      await fetch("/api/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
    } catch (err) { console.error("Approval failed:", err); }
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: newProjectDesc.trim() || null }),
      });
      setNewProjectName("");
      setNewProjectDesc("");
      setShowNewProject(false);
      loadProjects();
    } catch (err) { console.error("Create project failed:", err); }
  }

  async function addTask() {
    const title = newTaskTitle.trim();
    if (!title) return;
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: newTaskDesc.trim() || null,
          priority: newTaskPriority,
          status: newTaskStatus,
        }),
      });
      setNewTaskTitle("");
      setNewTaskDesc("");
      setNewTaskPriority("medium");
      setNewTaskStatus("backlog");
      setShowAddTask(false);
      loadTasks(activeProject);
    } catch (err) { console.error("Add task failed:", err); }
  }

  async function updateTaskStatus(taskId: number, status: ProjectTask["status"]) {
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      loadTasks(activeProject);
    } catch (err) { console.error("Update task failed:", err); }
  }

  async function deleteTask(taskId: number) {
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/tasks/${taskId}`, {
        method: "DELETE",
      });
      loadTasks(activeProject);
    } catch (err) { console.error("Delete task failed:", err); }
  }

  async function saveGlobalSettings(updates: Record<string, string>) {
    setSettingsSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setGlobalSettings((prev) => ({ ...prev, ...updates }));
    } catch (err) { console.error("Save settings failed:", err); }
    finally { setSettingsSaving(false); }
  }

  async function addSkill() {
    const name = newSkillName.trim();
    const content = newSkillContent.trim();
    if (!name || !content) return;
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      setNewSkillName("");
      setNewSkillContent("");
      setShowAddSkill(false);
      loadSkills(activeProject);
    } catch (err) { console.error("Add skill failed:", err); }
  }

  async function toggleSkill(skill: Skill) {
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !skill.active }),
      });
      loadSkills(activeProject);
    } catch (err) { console.error("Toggle skill failed:", err); }
  }

  async function deleteSkill(skillId: number) {
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/skills/${skillId}`, {
        method: "DELETE",
      });
      loadSkills(activeProject);
    } catch (err) { console.error("Delete skill failed:", err); }
  }

  async function saveSkillEdit() {
    if (!editingSkill) return;
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/skills/${editingSkill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingSkill.name, content: editingSkill.content }),
      });
      setEditingSkill(null);
      loadSkills(activeProject);
    } catch (err) { console.error("Save skill failed:", err); }
  }

  async function createContact() {
    if (!newContactName.trim()) return;
    try {
      await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newContactName, email: newContactEmail || null, phone: newContactPhone || null, company: newContactCompany || null, role: newContactRole || null }) });
      setNewContactName(""); setNewContactEmail(""); setNewContactPhone(""); setNewContactCompany(""); setNewContactRole("");
      setShowAddContact(false);
      loadContacts();
    } catch (err) { console.error("Create contact failed:", err); }
  }

  async function deleteContact(id: number) {
    try { await fetch(`/api/contacts/${id}`, { method: "DELETE" }); setSelectedContact(null); setContactDetail(null); loadContacts(); } catch (err) { console.error("Delete contact failed:", err); }
  }

  async function createCalendarEvent() {
    if (!newEventTitle.trim() || !newEventStart || !newEventEnd) return;
    try {
      await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newEventTitle, start_time: newEventStart, end_time: newEventEnd, event_type: newEventType, calendar_type: newEventCalType, description: newEventDesc || null, location: newEventLocation || null, contact_id: newEventContactId || null }) });
      setNewEventTitle(""); setNewEventStart(""); setNewEventEnd(""); setNewEventType("meeting"); setNewEventCalType("business"); setNewEventDesc(""); setNewEventLocation(""); setNewEventContactId(null);
      setShowAddEvent(false);
      loadCalendarEvents(calendarWeekStart);
    } catch (err) { console.error("Create event failed:", err); }
  }

  async function deleteCalendarEvent(id: number) {
    try { await fetch(`/api/calendar/${id}`, { method: "DELETE" }); setSelectedEvent(null); loadCalendarEvents(calendarWeekStart); } catch (err) { console.error("Delete event failed:", err); }
  }

  async function handleActionApproval(id: number, status: "approved" | "cancelled") {
    try {
      await fetch("/api/assistant/actions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      loadDashboard();
    } catch (err) { console.error("Action approval failed:", err); }
  }

  async function writeMemory() {
    if (!newMemKey.trim() || !newMemValue.trim()) return;
    try {
      await fetch("/api/office/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: newMemScope, key: newMemKey, value: newMemValue }) });
      setNewMemKey(""); setNewMemValue(""); setShowWriteMemory(false); loadMemory();
    } catch (err) { console.error("Write memory failed:", err); }
  }

  async function deleteMemory(entry: MemoryEntry) {
    try { await fetch(`/api/office/memory?scope=${entry.scope}&scope_id=${entry.scope_id}&key=${encodeURIComponent(entry.key)}`, { method: "DELETE" }); setSelectedMemory(null); loadMemory(); } catch (err) { console.error("Delete memory failed:", err); }
  }

  async function compressMemory() {
    try { await fetch("/api/office/memory/compress", { method: "POST" }); loadMemory(); } catch (err) { console.error("Compress failed:", err); }
  }

  async function toggleMemoryPin(entry: MemoryEntry) {
    try { await fetch("/api/office/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: entry.scope, scope_id: entry.scope_id, key: entry.key, value: entry.value, pinned: !entry.pinned }) }); loadMemory(); } catch (err) { console.error("Pin toggle failed:", err); }
  }

  async function updateContactNotes(id: number, notes: string) {
    try { await fetch(`/api/contacts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) }); } catch (err) { console.error("Update notes failed:", err); }
  }

  function showToast(message: string, type: "success" | "error" = "success") {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }

  async function updateTask(taskId: number, fields: Partial<ProjectTask>) {
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      loadTasks(activeProject);
      showToast("Task updated");
    } catch (err) { console.error("Update task failed:", err); showToast("Failed to update task", "error"); }
  }

  async function updateCalendarEvent(eventId: number, fields: Record<string, unknown>) {
    try {
      await fetch(`/api/calendar/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      loadCalendarEvents(calendarWeekStart);
      showToast("Event updated");
    } catch (err) { console.error("Update event failed:", err); showToast("Failed to update event", "error"); }
  }

  async function renameProject(projectId: string, name: string) {
    try {
      await fetch("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projectId, name }),
      });
      loadProjects();
      setEditingProject(null);
      showToast("Project renamed");
    } catch (err) { console.error("Rename project failed:", err); showToast("Failed to rename", "error"); }
  }

  async function deleteProject(projectId: string) {
    if (projectId === "general") { showToast("Cannot delete General project", "error"); return; }
    try {
      await fetch(`/api/channels?id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (activeProject === projectId) { setActiveProject("general"); setViewMode("chat"); }
      loadProjects();
      showToast("Project deleted");
    } catch (err) { console.error("Delete project failed:", err); showToast("Failed to delete", "error"); }
  }

  function handleDragStart(taskId: number) { setDraggedTaskId(taskId); }
  function handleDragEnd() { setDraggedTaskId(null); setDragOverColumn(null); }
  function handleDragOver(e: React.DragEvent, colKey: string) { e.preventDefault(); setDragOverColumn(colKey); }
  function handleDragLeave() { setDragOverColumn(null); }
  function handleDrop(colKey: string) {
    if (draggedTaskId !== null) {
      updateTaskStatus(draggedTaskId, colKey as ProjectTask["status"]);
    }
    setDraggedTaskId(null);
    setDragOverColumn(null);
  }

  async function updateContact(id: number, fields: Partial<Contact>) {
    try {
      await fetch(`/api/contacts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      loadContacts(contactSearch || undefined);
      if (selectedContact?.id === id) setSelectedContact({ ...selectedContact, ...fields } as Contact);
    } catch (err) { console.error("Update contact failed:", err); }
  }

  async function generateCallRecap(callId: number) {
    setRecappingCallId(callId);
    try {
      const res = await fetch(`/api/calls/${callId}/recap`, { method: "POST" });
      const data = await res.json();
      if (data.recap && contactDetail) {
        setContactDetail({
          ...contactDetail,
          calls: contactDetail.calls.map((c) => c.id === callId ? { ...c, recap: data.recap } : c),
        });
      }
    } catch (err) { console.error("Recap generation failed:", err); }
    finally { setRecappingCallId(null); }
  }

  function toggleReasoning(msgId: number) {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  }

  // ─── Lab Actions ────────────────────────────────────────────────
  async function runLabPrompt() {
    if (!labUserMessage.trim() || labRunning) return;
    setLabRunning(true);
    setLabResult(null);
    setLabResultB(null);

    try {
      if (labCompareMode) {
        const res = await fetch("/api/lab/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt: labSystemPrompt || undefined,
            userMessage: labUserMessage,
            providerA: labProvider,
            providerB: labProviderB,
          }),
        });
        const data = await res.json();
        if (data.a) setLabResult(data.a);
        if (data.b) setLabResultB(data.b);
      } else {
        const res = await fetch("/api/lab/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt: labSystemPrompt || undefined,
            userMessage: labUserMessage,
            provider: labProvider,
          }),
        });
        const data = await res.json();
        setLabResult(data);
      }
    } catch (err) {
      console.error("Lab run failed:", err);
      setLabResult({ text: "", provider: "", latency: 0, inputTokens: 0, outputTokens: 0, cost: "0", error: "Request failed" });
    } finally {
      setLabRunning(false);
    }
  }

  async function testSkillWithDrew(skill: Skill) {
    if (labRunning) return;
    setLabRunning(true);
    setLabResult(null);
    setLabResultB(null);

    try {
      const res = await fetch("/api/lab/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: `You are Drew, the AI brain. The following skill is loaded:\n\n### Skill: ${skill.name}\n${skill.content}\n\nRespond using this skill context.`,
          userMessage: "Demonstrate how you would use this skill in a typical response. Be concise.",
          provider: "claude-opus",
        }),
      });
      const data = await res.json();
      setLabResult(data);
    } catch (err) {
      console.error("Skill test failed:", err);
    } finally {
      setLabRunning(false);
    }
  }

  // ─── Voice ───────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) await transcribeAudio(blob);
      };
      mr.start();
      setRecording(true);
    } catch { /* mic denied */ }
  }
  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    setRecording(false);
  }
  async function transcribeAudio(blob: Blob) {
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");
      const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      if (data.text) await handleSend(data.text);
    } catch { /* transcription failed */ }
    finally { setTranscribing(false); }
  }
  async function playTTS(msg: Message) {
    if (playingTTS === msg.id) { ttsAudioRef.current?.pause(); setPlayingTTS(null); return; }
    setPlayingTTS(msg.id);
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.content, agent_id: "drew" }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      audio.onended = () => { setPlayingTTS(null); URL.revokeObjectURL(url); };
      audio.play();
    } catch { setPlayingTTS(null); }
  }

  // ─── Audio Notes ────────────────────────────────────────────────
  async function startAudioNote() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioNoteRecorderRef.current = mr;
      audioNoteChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioNoteChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioNoteChunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) setAudioNoteBlob(blob);
      };
      mr.start();
      setRecordingAudioNote(true);
    } catch { /* mic denied */ }
  }
  function stopAudioNote() {
    if (audioNoteRecorderRef.current?.state === "recording") audioNoteRecorderRef.current.stop();
    setRecordingAudioNote(false);
  }
  async function sendAudioNote() {
    if (!audioNoteBlob) return;
    setSending(true);
    try {
      // Transcribe the audio note
      const fd = new FormData();
      fd.append("audio", audioNoteBlob, "audio-note.webm");
      const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      if (data.text) {
        // Send as a message with audio note indicator
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `🎙️ *Audio note:* ${data.text}`, channel_id: activeProject }),
        });
      }
    } catch { showToast("Failed to send audio note", "error"); }
    finally { setSending(false); setAudioNoteBlob(null); }
  }
  function discardAudioNote() { setAudioNoteBlob(null); }

  // ─── Computed ────────────────────────────────────────────────────
  function switchProject(id: string) {
    setActiveProject(id);
    setTypingAgent(null);
    setMessages([]);
    setSkillsPanelOpen(false);
    setViewMode("chat");
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }

  const activeSkillCount = skills.filter((s) => s.active).length;

  const activeWorkspaceInfo = workspaces.find((w) => w.id === activeWorkspace) || { id: "default", name: "SteadyChat", description: null, member_count: 1 };
  const activeInfo = projects.find((p) => p.id === activeProject) || { id: "general", name: "General" };

  // ─── Render ──────────────────────────────────────────────────────
  // Session loading state
  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090b]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#00d4a8]/20">
            <span className="text-xl font-bold text-[#00d4a8]">S</span>
          </div>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-[#27272a]">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#00d4a8]" style={{ animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
          <p className="text-[13px] text-[#71717a]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`flex flex-col border-r border-border bg-sidebar-bg transition-all duration-200 ${
        sidebarOpen
          ? "fixed inset-y-0 left-0 z-50 w-[260px] md:relative md:z-auto"
          : "w-0 overflow-hidden"
      }`}>
        {/* Workspace header with switcher */}
        <div className="relative flex h-[49px] items-center gap-2.5 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/20">
            <span className="text-xs font-bold text-accent">S</span>
          </div>
          <button onClick={() => setShowWorkspaceSwitcher(!showWorkspaceSwitcher)} className="min-w-0 flex-1 text-left">
            <h1 className="truncate text-[15px] font-bold text-foreground leading-tight">{activeWorkspaceInfo.name}</h1>
          </button>
          <button
            onClick={() => setShowWorkspaceSwitcher(!showWorkspaceSwitcher)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            title="Switch workspace"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {showWorkspaceSwitcher && (
            <div className="absolute left-2 right-2 top-[48px] z-50 rounded-lg border border-border bg-surface shadow-xl">
              {workspaces.map((ws) => (
                <button key={ws.id} onClick={() => { setActiveWorkspace(ws.id); setShowWorkspaceSwitcher(false); }} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-hover-bg ${ws.id === activeWorkspace ? "text-accent font-medium" : "text-foreground"}`}>
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-accent/10 text-[10px] font-bold text-accent">{ws.name[0]}</div>
                  <span className="truncate">{ws.name}</span>
                  {ws.id === activeWorkspace && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto text-accent"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              ))}
              <div className="border-t border-border">
                <button className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-muted hover:bg-hover-bg hover:text-foreground">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Create Workspace
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {/* Dashboard */}
          <button
            onClick={() => navTo("dashboard")}
            className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
              viewMode === "dashboard" ? "bg-accent/15 font-semibold text-accent" : "text-foreground/70 hover:bg-hover-bg"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            Dashboard
            {pendingActionCount > 0 && (
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{pendingActionCount}</span>
            )}
          </button>

          {/* Projects section */}
          <div className="mt-4 mb-4">
            <div className="mb-0.5 flex items-center justify-between px-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Projects</span>
              <button onClick={() => setShowNewProject(true)} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:text-foreground" title="New project">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            {projects.filter((p) => !p.is_dm).map((proj) => (
              <div key={proj.id} className="group flex items-center">
                {editingProject === proj.id ? (
                  <div className="flex flex-1 items-center gap-1 px-4 py-0.5">
                    <input type="text" value={editProjectName} onChange={(e) => setEditProjectName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && editProjectName.trim()) renameProject(proj.id, editProjectName.trim()); if (e.key === "Escape") setEditingProject(null); }} className="min-w-0 flex-1 rounded border border-accent/50 bg-background px-2 py-0.5 text-[13px] text-foreground outline-none" autoFocus/>
                    <button onClick={() => { if (editProjectName.trim()) renameProject(proj.id, editProjectName.trim()); }} className="text-[10px] text-accent">Save</button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => switchProject(proj.id)}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-4 py-[5px] text-left text-[15px] transition-colors ${
                        activeProject === proj.id && (viewMode === "chat" || viewMode === "board")
                          ? "bg-accent/15 font-semibold text-accent"
                          : "text-foreground/70 hover:bg-hover-bg"
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted/60">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                      <span className="truncate">{proj.name}</span>
                    </button>
                    <div className="flex shrink-0 gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); setEditingProject(proj.id); setEditProjectName(proj.name); }} className="flex h-5 w-5 items-center justify-center rounded text-muted/60 hover:text-foreground" title="Rename">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      {proj.id !== "general" && (
                        <button onClick={(e) => { e.stopPropagation(); deleteProject(proj.id); }} className="flex h-5 w-5 items-center justify-center rounded text-muted/60 hover:text-red-400" title="Delete">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Direct Messages section */}
          <div className="mb-4">
            <div className="mb-0.5 flex items-center justify-between px-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Direct Messages</span>
              <button onClick={() => { setShowNewDM(true); loadDMUsers(); }} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:text-foreground" title="New DM">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            {showNewDM && (
              <div className="mx-4 mb-2 rounded-lg border border-border bg-surface p-2">
                <p className="text-[11px] text-muted mb-1.5">Select a user</p>
                {dmUsers.filter((u) => u.email !== session?.user?.email).map((u) => (
                  <button key={u.id} onClick={async () => {
                    try {
                      const res = await fetch("/api/dm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email }) });
                      if (res.ok) {
                        const dm = await res.json();
                        switchProject(dm.id);
                        loadProjects();
                      }
                    } catch {}
                    setShowNewDM(false);
                  }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-hover-bg">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-600/80 text-[10px] font-bold text-white">{u.name[0]?.toUpperCase()}</div>
                    {u.name}
                  </button>
                ))}
                {dmUsers.filter((u) => u.email !== session?.user?.email).length === 0 && (
                  <p className="text-[11px] text-muted/60 py-2 text-center">No other users yet. Invite someone from Admin.</p>
                )}
                <button onClick={() => setShowNewDM(false)} className="mt-1 w-full text-center text-[11px] text-muted hover:text-foreground">Cancel</button>
              </div>
            )}
            {projects.filter((p) => p.is_dm).map((dm) => {
              const otherEmail = dm.dm_user1 === session?.user?.email ? dm.dm_user2 : dm.dm_user1;
              const isOnline = onlineUsers.some((u) => u.email === otherEmail);
              return (
                <button key={dm.id} onClick={() => switchProject(dm.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[15px] transition-colors ${
                    activeProject === dm.id ? "bg-accent/15 font-semibold text-accent" : "text-foreground/70 hover:bg-hover-bg"
                  }`}>
                  <div className="relative">
                    <div className="flex h-5 w-5 items-center justify-center rounded-md bg-purple-600/80 text-[9px] font-bold text-white">{dm.name[0]?.toUpperCase()}</div>
                    {isOnline && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-sidebar-bg bg-green-500" />}
                  </div>
                  <span className="truncate">{dm.name}</span>
                </button>
              );
            })}
          </div>

          {/* Contacts & Calendar */}
          <div className="mb-4">
            <button
              onClick={() => { navTo("contacts"); setSelectedContact(null); }}
              className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
                viewMode === "contacts" ? "bg-accent/15 text-accent" : "text-foreground/70 hover:bg-hover-bg"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Contacts
            </button>
            <button
              onClick={() => { navTo("calendar"); setSelectedEvent(null); }}
              className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
                viewMode === "calendar" ? "bg-accent/15 text-accent" : "text-foreground/70 hover:bg-hover-bg"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Calendar
            </button>
          </div>

          {/* Files */}
          <div className="mb-4">
            <button
              onClick={() => navTo("files")}
              className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
                viewMode === "files" ? "bg-accent/15 text-accent" : "text-foreground/70 hover:bg-hover-bg"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              Files
            </button>
          </div>

          {/* Nav section */}
          <div className="border-t border-border pt-3">
            {/* Docs - opens new tab */}
            <a
              href="https://docs.steadybase.io"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors text-muted hover:bg-hover-bg hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
              Docs
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto opacity-50">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
            <button
              onClick={() => navTo("office")}
              className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
                viewMode === "office" ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover-bg hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              The Office
            </button>
            <button
              onClick={() => navTo("lab")}
              className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
                viewMode === "lab" ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover-bg hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M9 3h6v6l3 9H6l3-9V3z"/><line x1="8" y1="3" x2="16" y2="3"/>
              </svg>
              The Lab
            </button>
            <button
              onClick={() => navTo("settings")}
              className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
                viewMode === "settings" ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover-bg hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Settings
            </button>
            {session?.user?.role === "admin" && (
              <button
                onClick={() => navTo("admin")}
                className={`flex w-full items-center gap-2 rounded-md px-4 py-[5px] text-left text-[14px] transition-colors ${
                  viewMode === "admin" ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover-bg hover:text-foreground"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                Admin
              </button>
            )}
          </div>
        </div>

        {/* User footer */}
        <div className="flex items-center gap-2.5 border-t border-border px-4 py-2.5">
          <div className="relative">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">{(session?.user?.name || "U")[0].toUpperCase()}</div>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar-bg bg-green-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground leading-tight">{session?.user?.name || "User"}</p>
            <p className="text-[11px] text-green-500">Active</p>
          </div>
          <button onClick={() => setShowPasswordChange(true)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground" title="Change password">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </button>
          <button onClick={() => signOut()} className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground" title="Sign out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Project header */}
        <header className="flex h-[49px] items-center gap-3 border-b border-border px-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover-bg hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            {viewMode === "dashboard" ? (
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                <h2 className="text-[15px] font-bold text-foreground">Dashboard</h2>
                <span className="text-[12px] text-muted">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
              </div>
            ) : viewMode === "contacts" ? (
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                </svg>
                <h2 className="text-[15px] font-bold text-foreground">Contacts</h2>
              </div>
            ) : viewMode === "calendar" ? (
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <h2 className="text-[15px] font-bold text-foreground">Calendar</h2>
                <span className="text-[12px] text-muted">{calendarWeekStart.toLocaleDateString([], { month: "short", day: "numeric" })} - {new Date(calendarWeekStart.getTime() + 6 * 86400000).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
              </div>
            ) : viewMode === "office" ? (
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                <h2 className="text-[15px] font-bold text-foreground">The Office</h2>
              </div>
            ) : viewMode === "lab" ? (
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <path d="M9 3h6v6l3 9H6l3-9V3z"/><line x1="8" y1="3" x2="16" y2="3"/>
                </svg>
                <h2 className="text-[15px] font-bold text-foreground">The Lab</h2>
              </div>
            ) : viewMode === "files" ? (
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <h2 className="text-[15px] font-bold text-foreground">Files</h2>
              </div>
            ) : viewMode === "admin" ? (
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <h2 className="text-[15px] font-bold text-foreground">Admin</h2>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <h2 className="text-[15px] font-bold text-foreground">{activeInfo.name}</h2>
                </div>
                {activeInfo.description && (
                  <p className="truncate text-[12px] text-muted">{activeInfo.description}</p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Voice indicator */}
            {(recording || transcribing || playingTTS !== null) && (
              <div className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1">
                <div className="flex items-center gap-0.5">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className="h-3 w-0.5 animate-pulse rounded-full bg-accent" style={{ animationDelay: `${i * 100}ms`, height: `${8 + Math.random() * 8}px` }}/>
                  ))}
                </div>
                <span className="text-[10px] font-medium text-accent">
                  {recording ? "Listening" : transcribing ? "Transcribing" : "Speaking"}
                </span>
              </div>
            )}

            {/* Global search */}
            <div className="relative">
              <button onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50); else { setSearchQuery(""); setSearchResults(null); } }} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-hover-bg hover:text-foreground" title="Search (Cmd+K)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <kbd className="hidden sm:inline rounded border border-border bg-background px-1 py-px text-[9px] font-medium text-muted">&#8984;K</kbd>
              </button>
              {searchOpen && (
                <div className="absolute right-0 top-9 z-50 w-[400px] rounded-xl border border-border bg-surface shadow-xl">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input ref={searchInputRef} type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); doSearch(e.target.value); }} placeholder="Search contacts, events, tasks..." className="flex-1 bg-transparent text-[13px] text-foreground placeholder-muted outline-none" onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); } }}/>
                    <button onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); }} className="text-[10px] text-muted hover:text-foreground">ESC</button>
                  </div>
                  {searchResults && (
                    <div className="max-h-[400px] overflow-y-auto p-2">
                      {searchResults.contacts.length > 0 && (
                        <div className="mb-2">
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Contacts</p>
                          {searchResults.contacts.map((c) => (
                            <button key={c.id} onClick={() => { setViewMode("contacts"); setSearchOpen(false); setSearchQuery(""); setSearchResults(null); const contact: Contact = { ...c, phone: null, linkedin_url: null, channels: {}, notes: null, last_contacted_at: null }; setSelectedContact(contact); loadContactDetail(c.id); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover-bg">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold text-accent">{c.name.split(" ").map(n => n[0]).join("")}</div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-medium text-foreground truncate">{c.name}</p>
                                {c.company && <p className="text-[10px] text-muted truncate">{c.company}</p>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.events.length > 0 && (
                        <div className="mb-2">
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Events</p>
                          {searchResults.events.map((e) => (
                            <button key={e.id} onClick={() => { setViewMode("calendar"); setSearchOpen(false); setSearchQuery(""); setSearchResults(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover-bg">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[e.event_type] || "#6366f1" }}/>
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-medium text-foreground truncate">{e.title}</p>
                                <p className="text-[10px] text-muted">{formatDateShort(e.start_time)}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.tasks.length > 0 && (
                        <div className="mb-2">
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Tasks</p>
                          {searchResults.tasks.map((t) => (
                            <button key={t.id} onClick={() => { if (t.project_name) { const proj = projects.find(p => p.name === t.project_name); if (proj) setActiveProject(proj.id); } setViewMode("board"); setSearchOpen(false); setSearchQuery(""); setSearchResults(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover-bg">
                              <span className="rounded px-1 py-px text-[8px] font-bold uppercase" style={{ backgroundColor: `${PRIORITY_COLORS[t.priority]}20`, color: PRIORITY_COLORS[t.priority] }}>{t.priority}</span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-medium text-foreground truncate">{t.title}</p>
                                {t.project_name && <p className="text-[10px] text-accent">{t.project_name}</p>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.messages.length > 0 && (
                        <div className="mb-2">
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Messages</p>
                          {searchResults.messages.map((m) => (
                            <button key={m.id} onClick={() => { if (m.project_name) { const proj = projects.find(p => p.name === m.project_name); if (proj) setActiveProject(proj.id); } setViewMode("chat"); setSearchOpen(false); setSearchQuery(""); setSearchResults(null); }} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-hover-bg">
                              <p className="text-[12px] text-foreground/80 truncate">{m.content}</p>
                              <div className="flex items-center gap-2 text-[10px] text-muted">
                                <span>{m.sender}</span>
                                {m.project_name && <span className="text-accent">{m.project_name}</span>}
                                <span>{relativeTime(m.created_at)}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.contacts.length === 0 && searchResults.events.length === 0 && searchResults.tasks.length === 0 && searchResults.messages.length === 0 && (
                        <p className="py-4 text-center text-[12px] text-muted">No results found</p>
                      )}
                    </div>
                  )}
                  {!searchResults && searchQuery.length < 2 && (
                    <p className="py-4 text-center text-[12px] text-muted">Type to search...</p>
                  )}
                </div>
              )}
            </div>

            {/* Drew avatar with voice indicator */}
            <div className="relative">
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background text-[9px] font-bold text-white" style={{ backgroundColor: drewMeta.color }}>D</div>
              {(recording || transcribing || playingTTS !== null) && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent animate-pulse"/>
              )}
            </div>

            {/* View mode tabs — only for project views */}
            {(viewMode === "chat" || viewMode === "board") && (
              <div className="flex rounded-md border border-border bg-background">
                {(["chat", "board"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                      viewMode === mode ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
                    } ${mode === "chat" ? "rounded-l-md" : "rounded-r-md"}`}
                  >
                    {mode === "chat" ? "Chat" : "Board"}
                  </button>
                ))}
              </div>
            )}
            {/* Lab tab bar */}
            {viewMode === "lab" && (
              <div className="flex rounded-md border border-border bg-background">
                {(["sandbox", "skills", "spawn"] as const).map((tab, i) => (
                  <button
                    key={tab}
                    onClick={() => setLabTab(tab)}
                    className={`px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                      labTab === tab ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
                    } ${i === 0 ? "rounded-l-md" : i === 2 ? "rounded-r-md" : ""}`}
                  >
                    {tab === "sandbox" ? "Prompt Sandbox" : tab === "skills" ? "Skill Editor" : "Spawn Tester"}
                  </button>
                ))}
              </div>
            )}
            {/* Office tab bar */}
            {viewMode === "office" && (
              <div className="flex rounded-md border border-border bg-background">
                {(["floor", "memory", "workflows"] as const).map((tab, i) => (
                  <button key={tab} onClick={() => setOfficeTab(tab)} className={`px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${officeTab === tab ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"} ${i === 0 ? "rounded-l-md" : i === 2 ? "rounded-r-md" : ""}`}>
                    {tab === "floor" ? "Floor" : tab === "memory" ? "Memory" : "Workflows"}
                  </button>
                ))}
              </div>
            )}
            {/* Office refresh */}
            {viewMode === "office" && (
              <button
                onClick={() => { loadOfficeMetrics(); loadActivityFeed(); }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover-bg hover:text-foreground"
                title="Refresh"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            )}
            {(viewMode === "chat" || viewMode === "board") && (
              <>
                <button
                  onClick={() => setSkillsPanelOpen(!skillsPanelOpen)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                    skillsPanelOpen ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover-bg hover:text-foreground"
                  }`}
                  title="Project skills"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                  </svg>
                  Skills{activeSkillCount > 0 && <span className="rounded bg-accent/20 px-1 text-[10px] text-accent">{activeSkillCount}</span>}
                </button>
              </>
            )}
          </div>
        </header>

        {/* Main content with optional skills panel */}
        <div className="flex min-h-0 flex-1">
        {/* Content column */}
        <div className="flex min-w-0 flex-1 flex-col">

        {/* ── Dashboard View ── */}
        {viewMode === "dashboard" && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-4xl">
              {/* Greeting */}
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-foreground">{getGreeting()}, Andrew.</h2>
                {dashboardData && (
                  <p className="mt-1 text-[14px] text-muted">
                    {dashboardData.summary.meetingCount} meeting{dashboardData.summary.meetingCount !== 1 ? "s" : ""}, {dashboardData.summary.taskCount} task{dashboardData.summary.taskCount !== 1 ? "s" : ""}, {dashboardData.summary.followUpCount} follow-up{dashboardData.summary.followUpCount !== 1 ? "s" : ""} today
                  </p>
                )}
              </div>

              {/* Voice bar */}
              <div className="mb-6 rounded-xl border border-border bg-surface/50 p-4">
                <div className="flex items-center gap-3">
                  <button
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={() => recording && stopRecording()}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    disabled={sending || transcribing}
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all ${
                      recording ? "bg-red-500 text-white scale-110" : transcribing ? "bg-accent/20 text-accent" : "bg-accent/10 text-accent hover:bg-accent/20"
                    }`}
                    title="Hold to speak"
                  >
                    {transcribing ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent"/>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                      </svg>
                    )}
                  </button>
                  <div className="flex-1">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { handleSend(); } }}
                      placeholder={recording ? "Listening..." : transcribing ? "Transcribing..." : "Ask Drew anything..."}
                      disabled={sending || recording || transcribing}
                      className="w-full bg-transparent text-[15px] text-foreground placeholder-muted outline-none"
                    />
                  </div>
                  {input.trim() && (
                    <button onClick={() => handleSend()} className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white hover:opacity-90">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                  )}
                </div>
                {recording && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-red-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"/>Recording...</p>}
              </div>

              {/* Pending Actions */}
              {dashboardData && dashboardData.pendingActions.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted">Drew Wants To</h3>
                  <div className="space-y-2">
                    {dashboardData.pendingActions.map((action) => (
                      <div key={action.id} className="flex items-center gap-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                          {action.action_type === "email" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00d4a8" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
                          {action.action_type === "call" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00d4a8" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>}
                          {action.action_type === "follow_up" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00d4a8" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>}
                          {!["email", "call", "follow_up"].includes(action.action_type) && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00d4a8" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-foreground">{action.title}</p>
                          {action.description && <p className="mt-0.5 text-[12px] text-muted line-clamp-1">{action.description}</p>}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => handleActionApproval(action.id, "approved")} className="rounded-md bg-green-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-green-700">Approve</button>
                          <button onClick={() => handleActionApproval(action.id, "cancelled")} className="rounded-md border border-border px-3 py-1 text-[12px] font-medium text-muted hover:text-foreground">Decline</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="dashboard-grid grid grid-cols-2 gap-4">
                {/* Today's Schedule */}
                <div className="rounded-xl border border-border bg-surface/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Today&apos;s Schedule</h3>
                    <button onClick={() => setViewMode("calendar")} className="text-[10px] text-accent hover:underline">View all</button>
                  </div>
                  {dashboardData && dashboardData.events.length > 0 ? (
                    <div className="space-y-2">
                      {dashboardData.events.map((ev) => (
                        <button key={ev.id} onClick={() => { setViewMode("calendar"); setCalendarWeekStart(getMonday(new Date(ev.start_time))); setSelectedEvent(ev); }} className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-background p-2.5 text-left transition-colors hover:border-accent/30">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[ev.event_type] || "#6366f1" }}/>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-foreground truncate">{ev.title}</p>
                            <p className="text-[11px] text-muted">{formatTimeRange(ev.start_time, ev.end_time)}{ev.location ? ` - ${ev.location}` : ""}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-[12px] text-muted">No events today</p>
                  )}
                </div>

                {/* Priority Tasks */}
                <div className="rounded-xl border border-border bg-surface/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Priority Tasks</h3>
                    <button onClick={() => setViewMode("board")} className="text-[10px] text-accent hover:underline">View all</button>
                  </div>
                  {dashboardData && dashboardData.tasks.length > 0 ? (
                    <div className="space-y-2">
                      {dashboardData.tasks.slice(0, 6).map((task) => (
                        <button key={task.id} onClick={() => { if (task.project_name) { const proj = projects.find(p => p.name === task.project_name); if (proj) setActiveProject(proj.id); } setViewMode("board"); }} className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-background p-2.5 text-left transition-colors hover:border-accent/30">
                          <span className="rounded px-1.5 py-px text-[9px] font-bold uppercase" style={{ backgroundColor: `${PRIORITY_COLORS[task.priority]}20`, color: PRIORITY_COLORS[task.priority] }}>{task.priority}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-foreground truncate">{task.title}</p>
                            {task.project_name && <p className="text-[10px] text-accent">{task.project_name}</p>}
                          </div>
                          {task.due_date && <span className="shrink-0 text-[10px] text-muted">{formatDateShort(task.due_date)}</span>}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-[12px] text-muted">No priority tasks</p>
                  )}
                </div>

                {/* Follow-ups */}
                <div className="rounded-xl border border-border bg-surface/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Follow-ups Needed</h3>
                    <button onClick={() => { navTo("contacts"); setSelectedContact(null); }} className="text-[10px] text-accent hover:underline">View all</button>
                  </div>
                  {dashboardData && dashboardData.followUps.length > 0 ? (
                    <div className="space-y-2">
                      {dashboardData.followUps.slice(0, 5).map((contact) => (
                        <div key={contact.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-background p-2.5 cursor-pointer hover:border-accent/30" onClick={() => { setViewMode("contacts"); setSelectedContact(contact); loadContactDetail(contact.id); }}>
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">{contact.name.split(" ").map(n => n[0]).join("")}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-foreground truncate">{contact.name}</p>
                            {contact.company && <p className="text-[10px] text-muted">{contact.company}</p>}
                          </div>
                          <span className="shrink-0 rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">{daysSince(contact.last_contacted_at)}d ago</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-[12px] text-muted">All contacts up to date</p>
                  )}
                </div>

                {/* Recent Activity */}
                <div className="rounded-xl border border-border bg-surface/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Recent Activity</h3>
                    <button onClick={() => navTo("office")} className="text-[10px] text-accent hover:underline">View all</button>
                  </div>
                  {dashboardData && dashboardData.activity.length > 0 ? (
                    <div className="space-y-2">
                      {dashboardData.activity.slice(0, 6).map((entry, i) => (
                        <div key={`${entry.type}-${entry.id}-${i}`} className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            {entry.type === "message" && <div className="flex h-5 w-5 items-center justify-center rounded bg-accent/10"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#00d4a8" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>}
                            {entry.type === "task" && <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-500/10"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] text-foreground/80 leading-snug truncate">{entry.description}</p>
                            <span className="text-[10px] text-muted">{relativeTime(entry.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-[12px] text-muted">No recent activity</p>
                  )}
                </div>
              </div>

              {dashboardLoading && (
                <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent"/></div>
              )}
            </div>
          </div>
        )}

        {/* ── Contacts View ── */}
        {viewMode === "contacts" && (
          <div className="flex min-h-0 flex-1">
            {/* Contact list */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <div className="flex-1">
                  <input type="text" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="Search contacts..." className="w-full bg-transparent text-[13px] text-foreground placeholder-muted outline-none"/>
                </div>
                <button onClick={() => setShowAddContact(!showAddContact)} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Contact
                </button>
              </div>

              {showAddContact && (
                <div className="border-b border-border bg-surface/50 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={newContactName} onChange={(e) => setNewContactName(e.target.value)} placeholder="Name *" className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder-muted outline-none" autoFocus/>
                    <input type="text" value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} placeholder="Email" className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder-muted outline-none"/>
                    <input type="text" value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} placeholder="Phone" className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder-muted outline-none"/>
                    <input type="text" value={newContactCompany} onChange={(e) => setNewContactCompany(e.target.value)} placeholder="Company" className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder-muted outline-none"/>
                    <input type="text" value={newContactRole} onChange={(e) => setNewContactRole(e.target.value)} placeholder="Role" className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder-muted outline-none"/>
                    <div className="flex gap-2">
                      <button onClick={createContact} disabled={!newContactName.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-30">Add</button>
                      <button onClick={() => setShowAddContact(false)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {contacts.map((contact) => {
                  const ch = (contact.channels && typeof contact.channels === "object") ? contact.channels : {};
                  return (
                    <button key={contact.id} onClick={() => { setSelectedContact(contact); loadContactDetail(contact.id); }} className={`flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-hover-bg ${selectedContact?.id === contact.id ? "bg-accent/5" : ""}`}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent">{contact.name.split(" ").map(n => n[0]).join("")}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-foreground truncate">{contact.name}</p>
                        <div className="flex items-center gap-2">
                          {contact.company && <p className="text-[12px] text-muted truncate">{contact.company}{contact.role ? ` - ${contact.role}` : ""}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {ch.email && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted/60"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
                        {ch.phone && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted/60"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>}
                        {ch.sms && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted/60"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
                        {ch.linkedin && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted/60"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>}
                      </div>
                      {contact.last_contacted_at && <span className="shrink-0 text-[10px] text-muted">{relativeTime(contact.last_contacted_at)}</span>}
                    </button>
                  );
                })}
                {contacts.length === 0 && <p className="py-8 text-center text-[13px] text-muted">No contacts found</p>}
              </div>
            </div>

            {/* Contact detail panel */}
            {selectedContact && (
              <div className="detail-panel flex w-[380px] shrink-0 flex-col border-l border-border bg-sidebar-bg overflow-y-auto">
                {/* Mobile back button */}
                <button onClick={() => { setSelectedContact(null); setContactDetail(null); }} className="detail-panel-close hidden items-center gap-1.5 border-b border-border px-4 py-2.5 text-[13px] text-muted hover:text-foreground md:!hidden">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                  Back to contacts
                </button>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">{selectedContact.name.split(" ").map(n => n[0]).join("")}</div>
                    <div className="min-w-0 flex-1">
                      {editingContact?.id === selectedContact.id ? (
                        <div className="space-y-1.5">
                          <input type="text" value={editingContact.name} onChange={(e) => setEditingContact({ ...editingContact, name: e.target.value })} className="w-full rounded border border-border bg-background px-2 py-1 text-[14px] font-bold text-foreground outline-none focus:border-accent" autoFocus/>
                          <input type="text" value={editingContact.role || ""} onChange={(e) => setEditingContact({ ...editingContact, role: e.target.value || null })} placeholder="Role" className="w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground placeholder-muted outline-none focus:border-accent"/>
                          <input type="text" value={editingContact.company || ""} onChange={(e) => setEditingContact({ ...editingContact, company: e.target.value || null })} placeholder="Company" className="w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground placeholder-muted outline-none focus:border-accent"/>
                          <input type="text" value={editingContact.email || ""} onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value || null })} placeholder="Email" className="w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground placeholder-muted outline-none focus:border-accent"/>
                          <input type="text" value={editingContact.phone || ""} onChange={(e) => setEditingContact({ ...editingContact, phone: e.target.value || null })} placeholder="Phone" className="w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground placeholder-muted outline-none focus:border-accent"/>
                          <div className="flex gap-1.5 pt-1">
                            <button onClick={() => { updateContact(selectedContact.id, { name: editingContact.name, role: editingContact.role, company: editingContact.company, email: editingContact.email, phone: editingContact.phone }); setEditingContact(null); }} className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90">Save</button>
                            <button onClick={() => setEditingContact(null)} className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <h3 className="text-[16px] font-bold text-foreground">{selectedContact.name}</h3>
                          {selectedContact.company && <p className="text-[13px] text-muted">{selectedContact.role ? `${selectedContact.role} @ ` : ""}{selectedContact.company}</p>}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!editingContact && (
                        <button onClick={() => setEditingContact({ ...selectedContact })} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-foreground" title="Edit contact">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                      <button onClick={() => deleteContact(selectedContact.id)} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-red-400" title="Delete contact">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                  {!editingContact && selectedContact.email && <p className="mt-2 text-[12px] text-muted">{selectedContact.email}</p>}
                  {!editingContact && selectedContact.phone && <p className="text-[12px] text-muted">{selectedContact.phone}</p>}

                  <div className="mt-3 flex gap-2">
                    <button onClick={() => { setActiveProject("general"); setViewMode("chat"); setInput(`Tell me about ${selectedContact.name} at ${selectedContact.company || "their company"}`); setTimeout(() => inputRef.current?.focus(), 100); }} className="flex-1 rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-[12px] font-medium text-accent hover:bg-accent/10">
                      Ask Drew
                    </button>
                    <button disabled className="flex-1 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-muted cursor-not-allowed opacity-50" title="Coming with Telnyx">
                      Have Drew Call
                    </button>
                  </div>
                </div>

                {/* Calls */}
                {contactDetail && contactDetail.calls.length > 0 && (
                  <div className="border-t border-border p-4">
                    <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Calls</h4>
                    <div className="space-y-2">
                      {contactDetail.calls.map((call) => (
                        <div key={call.id} className="rounded-lg border border-border bg-background p-2.5">
                          <div className="flex items-center gap-2">
                            <p className="flex-1 text-[12px] font-medium text-foreground truncate">{call.title}</p>
                            {call.assistant_joined && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold text-accent">Drew joined</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                            <span>{relativeTime(call.created_at)}</span>
                            {call.duration_seconds && <span>{Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s</span>}
                            <span className="rounded bg-surface px-1 py-px text-[9px]">{call.status}</span>
                          </div>
                          {call.recap ? (
                            <p className="mt-1.5 text-[11px] text-foreground/70 line-clamp-3">{call.recap}</p>
                          ) : call.transcript ? (
                            <button onClick={() => generateCallRecap(call.id)} disabled={recappingCallId === call.id} className="mt-1.5 flex items-center gap-1 rounded bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
                              {recappingCallId === call.id ? (<><div className="h-2.5 w-2.5 animate-spin rounded-full border border-accent/30 border-t-accent"/>Generating...</>) : (<><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Generate Recap</>)}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Interactions */}
                {contactDetail && contactDetail.interactions.length > 0 && (
                  <div className="border-t border-border p-4">
                    <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Interactions</h4>
                    <div className="space-y-2">
                      {contactDetail.interactions.map((int) => (
                        <div key={int.id} className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            <div className="flex h-5 w-5 items-center justify-center rounded bg-surface">
                              {int.type === "email" && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
                              {int.type === "call" && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted"><path d="M22 16.92v3a2 2 0 0 1-2.18 2"/></svg>}
                              {int.type === "meeting" && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>}
                              {!["email", "call", "meeting"].includes(int.type) && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] text-foreground/80 leading-snug">{int.summary}</p>
                            <div className="mt-0.5 flex items-center gap-2">
                              {int.initiated_by === "assistant" && <span className="rounded bg-accent/10 px-1 py-px text-[9px] font-medium text-accent">by Drew</span>}
                              <span className="text-[10px] text-muted">{relativeTime(int.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div className="border-t border-border p-4">
                  <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Notes</h4>
                  <textarea
                    defaultValue={selectedContact.notes || ""}
                    onBlur={(e) => updateContactNotes(selectedContact.id, e.target.value)}
                    placeholder="Add notes..."
                    rows={3}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none resize-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Calendar View ── */}
        {viewMode === "calendar" && (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
              {/* Calendar header */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <button onClick={() => setCalendarWeekStart(new Date(calendarWeekStart.getTime() - 7 * 86400000))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover-bg hover:text-foreground">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button onClick={() => setCalendarWeekStart(getMonday(new Date()))} className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-hover-bg">This Week</button>
                <button onClick={() => setCalendarWeekStart(new Date(calendarWeekStart.getTime() + 7 * 86400000))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover-bg hover:text-foreground">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <div className="flex rounded-md border border-border bg-background">
                    {(["all", "business", "personal"] as const).map((f, i) => (
                      <button key={f} onClick={() => setCalendarFilter(f)} className={`px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${calendarFilter === f ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"} ${i === 0 ? "rounded-l-md" : i === 2 ? "rounded-r-md" : ""}`}>{f}</button>
                    ))}
                  </div>
                  <button onClick={() => { setShowAddEvent(true); if (contacts.length === 0) loadContacts(); }} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Event
                  </button>
                </div>
              </div>

              {/* Day-by-day agenda */}
              <div className="flex-1 p-4">
                {Array.from({ length: 7 }).map((_, dayIdx) => {
                  const day = new Date(calendarWeekStart.getTime() + dayIdx * 86400000);
                  const dayStr = day.toDateString();
                  const dayEvents = calendarEvents.filter((ev) => {
                    if (calendarFilter !== "all" && ev.calendar_type !== calendarFilter) return false;
                    return new Date(ev.start_time).toDateString() === dayStr;
                  });
                  const isToday = day.toDateString() === new Date().toDateString();
                  return (
                    <div key={dayIdx} className="mb-4">
                      <h4 className={`mb-2 text-[13px] font-semibold ${isToday ? "text-accent" : "text-foreground"}`}>
                        {day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                        {isToday && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">Today</span>}
                      </h4>
                      {dayEvents.length > 0 ? (
                        <div className="space-y-1.5 pl-3">
                          {dayEvents.map((ev) => (
                            <button key={ev.id} onClick={() => setSelectedEvent(ev)} className={`flex w-full items-center gap-2.5 rounded-lg border border-border/50 bg-background p-2.5 text-left transition-colors hover:border-accent/30 ${selectedEvent?.id === ev.id ? "border-accent/30 bg-accent/5" : ""}`}>
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[ev.event_type] || "#6366f1" }}/>
                              <span className="w-24 shrink-0 text-[12px] text-muted">{formatTimeRange(ev.start_time, ev.end_time)}</span>
                              <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground truncate">{ev.title}</span>
                              {ev.contact_name && <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{ev.contact_name}</span>}
                              {ev.location && <span className="shrink-0 text-[10px] text-muted">{ev.location}</span>}
                              {ev.created_by === "assistant" && <span className="shrink-0 rounded bg-accent/10 px-1 py-px text-[9px] text-accent">by Drew</span>}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="pl-3 text-[12px] text-muted/60">No events</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Event detail panel */}
            {selectedEvent && (
              <div className="detail-panel flex w-[380px] shrink-0 flex-col border-l border-border bg-sidebar-bg overflow-y-auto">
                {/* Mobile back button */}
                <button onClick={() => setSelectedEvent(null)} className="detail-panel-close hidden items-center gap-1.5 border-b border-border px-4 py-2.5 text-[13px] text-muted hover:text-foreground md:!hidden">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                  Back to calendar
                </button>
                <div className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-[16px] font-bold text-foreground">{selectedEvent.title}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium capitalize" style={{ backgroundColor: `${EVENT_TYPE_COLORS[selectedEvent.event_type]}20`, color: EVENT_TYPE_COLORS[selectedEvent.event_type] }}>{selectedEvent.event_type}</span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted capitalize">{selectedEvent.calendar_type}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditingEvent({ ...selectedEvent })} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-foreground" title="Edit event">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button onClick={() => { deleteCalendarEvent(selectedEvent.id); showToast("Event deleted"); }} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-red-400">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>

                {editingEvent?.id === selectedEvent.id ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted">Title</label>
                      <input type="text" value={editingEvent.title} onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"/>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-medium text-muted">Start</label>
                        <input type="datetime-local" value={editingEvent.start_time ? new Date(editingEvent.start_time).toISOString().slice(0, 16) : ""} onChange={(e) => setEditingEvent({ ...editingEvent, start_time: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none"/>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted">End</label>
                        <input type="datetime-local" value={editingEvent.end_time ? new Date(editingEvent.end_time).toISOString().slice(0, 16) : ""} onChange={(e) => setEditingEvent({ ...editingEvent, end_time: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none"/>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted">Location</label>
                      <input type="text" value={editingEvent.location || ""} onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value || null })} placeholder="Zoom, Office..." className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none"/>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted">Description</label>
                      <textarea value={editingEvent.description || ""} onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value || null })} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"/>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { updateCalendarEvent(selectedEvent.id, { title: editingEvent.title, start_time: editingEvent.start_time, end_time: editingEvent.end_time, location: editingEvent.location, description: editingEvent.description }); setEditingEvent(null); setSelectedEvent({ ...selectedEvent, ...editingEvent }); }} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">Save</button>
                      <button onClick={() => setEditingEvent(null)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                ) : (
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-[11px] font-medium text-muted">Date & Time</p>
                    <p className="text-[13px] text-foreground">{new Date(selectedEvent.start_time).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
                    <p className="text-[13px] text-foreground">{formatTimeRange(selectedEvent.start_time, selectedEvent.end_time)}</p>
                  </div>
                  {selectedEvent.contact_name && (
                    <div>
                      <p className="text-[11px] font-medium text-muted">Contact</p>
                      <button onClick={() => { const contact = contacts.find(c => c.id === selectedEvent.contact_id); if (contact) { setSelectedContact(contact); loadContactDetail(contact.id); setViewMode("contacts"); } else if (selectedEvent.contact_id) { loadContacts(); setViewMode("contacts"); } }} className="text-[13px] font-medium text-accent hover:underline">{selectedEvent.contact_name}</button>
                    </div>
                  )}
                  {selectedEvent.location && <div><p className="text-[11px] font-medium text-muted">Location</p><p className="text-[13px] text-foreground">{selectedEvent.location}</p></div>}
                  {selectedEvent.description && <div><p className="text-[11px] font-medium text-muted">Description</p><p className="text-[13px] text-foreground/80">{selectedEvent.description}</p></div>}
                  {selectedEvent.assistant_prep && (
                    <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
                      <p className="text-[11px] font-bold text-accent">Drew&apos;s Prep</p>
                      <p className="mt-1 text-[12px] text-foreground/80 leading-relaxed">{selectedEvent.assistant_prep}</p>
                    </div>
                  )}
                  {selectedEvent.created_by === "assistant" && <p className="text-[11px] text-accent">Scheduled by Drew</p>}
                </div>
                )}

                {/* Prep me button */}
                {(selectedEvent.event_type === "meeting" || selectedEvent.event_type === "call") && (
                  <button
                    onClick={() => prepEvent(selectedEvent.id)}
                    disabled={preppingEventId === selectedEvent.id}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-[13px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                  >
                    {preppingEventId === selectedEvent.id ? (
                      <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent"/>Prepping...</>
                    ) : (
                      <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>{selectedEvent.assistant_prep ? "Re-prep" : "Prep me"}</>
                    )}
                  </button>
                )}

                <button onClick={() => setSelectedEvent(null)} className="mt-2 w-full rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground">Close</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Office View ── */}
        {viewMode === "office" && (
          <div className="flex min-h-0 flex-1">
            {/* Office main area */}
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">

            {/* Floor tab */}
            {officeTab === "floor" && (<>
              {/* KPI Bar */}
              <div className="kpi-grid grid grid-cols-4 gap-3 p-4">
                {[
                  { label: "Workers", value: `${officeMetrics.activeWorkers} active`, icon: "users", color: "#00d4a8" },
                  { label: "Tasks", value: `${officeMetrics.tasksCompleted} done`, icon: "check", color: "#22c55e" },
                  { label: "Tokens", value: `$${officeMetrics.estimatedCost}`, icon: "zap", color: "#f59e0b" },
                  { label: "Memory", value: `${officeMetrics.memoryHealth}%`, icon: "brain", color: "#8b5cf6" },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-lg border border-border bg-surface/50 p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${kpi.color}15` }}>
                        {kpi.icon === "users" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={kpi.color} strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                        {kpi.icon === "check" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={kpi.color} strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>}
                        {kpi.icon === "zap" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={kpi.color} strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>}
                        {kpi.icon === "brain" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={kpi.color} strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/></svg>}
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-muted">{kpi.label}</p>
                        <p className="text-[15px] font-bold text-foreground">{kpi.value}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Worker Cards Grid */}
              <div className="flex-1 px-4 pb-4">
                <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted">Office Floor</h3>
                <div className="office-grid grid grid-cols-2 gap-3">
                  {[
                    { id: "drew", name: "Drew", role: "Brain", color: "#00d4a8", avatar: "D", active: officeMetrics.activeWorkers > 0 },
                    { id: "brian", name: "Brian", role: "Builder", color: "#6366f1", avatar: "B", active: false },
                    { id: "lisa", name: "Lisa", role: "Researcher", color: "#f59e0b", avatar: "L", active: false },
                    { id: "vera", name: "Vera", role: "QA", color: "#ec4899", avatar: "V", active: false },
                  ].map((worker) => (
                    <div key={worker.id} className="rounded-xl border border-border bg-surface/50 p-4 transition-colors hover:border-accent/20">
                      {/* Worker header */}
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                          style={{ backgroundColor: worker.color }}
                        >
                          {worker.avatar}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold text-foreground">{worker.name}</span>
                            <span className="rounded bg-surface px-1.5 py-px text-[10px] font-medium text-muted">{worker.role}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`h-2 w-2 rounded-full ${worker.active ? "bg-green-500 pulse-dot" : "bg-zinc-600"}`} />
                            <span className={`text-[11px] ${worker.active ? "text-green-400" : "text-muted"}`}>
                              {worker.active ? "Running" : "Idle"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Current task or idle message */}
                      <div className="mt-3 rounded-lg border border-border/50 bg-background p-2.5">
                        {worker.active ? (
                          <>
                            <p className="text-[11px] font-medium text-muted">Current Task</p>
                            <p className="mt-0.5 text-[12px] text-foreground">Responding to user...</p>
                          </>
                        ) : (
                          <p className="text-[12px] text-muted">No active task</p>
                        )}
                      </div>

                      {/* Metrics row */}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-muted">Duration</p>
                          <p className="text-[12px] font-medium text-foreground">{worker.active ? "—" : "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted">Tokens</p>
                          <p className="text-[12px] font-medium text-foreground">{worker.id === "drew" ? `$${officeMetrics.estimatedCost}` : "—"}</p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-3 h-1 rounded-full bg-border">
                        {worker.active && (
                          <div className="h-full rounded-full bg-accent animate-pulse" style={{ width: "60%" }} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>)}

            {/* Memory tab */}
            {officeTab === "memory" && (
              <div className="p-4">
                {/* Health stats */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {[
                    { label: "Total Entries", value: memoryHealth.total, color: "#00d4a8" },
                    { label: "Pinned", value: memoryHealth.pinned, color: "#f59e0b" },
                    { label: "Stale %", value: `${memoryHealth.stalePercent}%`, color: "#ef4444" },
                    { label: "Compression", value: `${memoryHealth.compressionRatio}x`, color: "#8b5cf6" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="rounded-lg border border-border bg-surface/50 p-3">
                      <p className="text-[10px] font-medium text-muted">{kpi.label}</p>
                      <p className="text-[18px] font-bold text-foreground">{kpi.value}</p>
                    </div>
                  ))}
                </div>

                {/* Scope filter */}
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex rounded-md border border-border bg-background">
                    {["all", "org", "team", "worker", "session"].map((s, i) => (
                      <button key={s} onClick={() => setMemoryFilter(s)} className={`px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${memoryFilter === s ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"} ${i === 0 ? "rounded-l-md" : i === 4 ? "rounded-r-md" : ""}`}>{s}</button>
                    ))}
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => setShowWriteMemory(!showWriteMemory)} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Write
                    </button>
                    <button onClick={compressMemory} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground">Compress Stale</button>
                  </div>
                </div>

                {showWriteMemory && (
                  <div className="mb-4 rounded-lg border border-border bg-surface/50 p-3">
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <select value={newMemScope} onChange={(e) => setNewMemScope(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none">
                        <option value="org">org</option><option value="team">team</option><option value="worker">worker</option><option value="session">session</option>
                      </select>
                      <input type="text" value={newMemKey} onChange={(e) => setNewMemKey(e.target.value)} placeholder="Key" className="rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-foreground placeholder-muted outline-none"/>
                      <div className="flex gap-1">
                        <button onClick={writeMemory} disabled={!newMemKey.trim() || !newMemValue.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white disabled:opacity-30">Save</button>
                        <button onClick={() => setShowWriteMemory(false)} className="rounded-lg border border-border px-2 py-1.5 text-[12px] text-muted">X</button>
                      </div>
                    </div>
                    <textarea value={newMemValue} onChange={(e) => setNewMemValue(e.target.value)} placeholder="Value..." rows={2} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-foreground placeholder-muted outline-none resize-none"/>
                  </div>
                )}

                {/* Two-column: entries + detail */}
                <div className="flex gap-4">
                  <div className="flex-1 space-y-1">
                    {memoryEntries
                      .filter((e) => memoryFilter === "all" || e.scope === memoryFilter)
                      .map((entry) => (
                        <button key={entry.id} onClick={() => setSelectedMemory(entry)} className={`flex w-full items-center gap-2 rounded-lg border p-2.5 text-left transition-colors ${selectedMemory?.id === entry.id ? "border-accent/30 bg-accent/5" : "border-border hover:bg-hover-bg"}`}>
                          <span className="rounded bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted">{entry.scope}</span>
                          <span className="min-w-0 flex-1 text-[12px] font-medium text-foreground truncate">{entry.key}</span>
                          {entry.pinned && <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="2"><circle cx="12" cy="12" r="3"/></svg>}
                          <span className="text-[10px] text-muted">v{entry.version}</span>
                        </button>
                      ))}
                    {memoryEntries.filter((e) => memoryFilter === "all" || e.scope === memoryFilter).length === 0 && (
                      <p className="py-8 text-center text-[12px] text-muted">No entries</p>
                    )}
                  </div>
                  {selectedMemory && (
                    <div className="w-[40%] shrink-0 rounded-lg border border-border bg-surface/50 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent uppercase">{selectedMemory.scope}</span>
                        <div className="flex gap-1">
                          <button onClick={() => toggleMemoryPin(selectedMemory)} className={`flex h-6 w-6 items-center justify-center rounded ${selectedMemory.pinned ? "text-yellow-400" : "text-muted"} hover:bg-hover-bg`} title={selectedMemory.pinned ? "Unpin" : "Pin"}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill={selectedMemory.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          <button onClick={() => deleteMemory(selectedMemory)} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-red-400 hover:bg-hover-bg">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </div>
                      <p className="text-[14px] font-bold text-foreground mb-1">{selectedMemory.key}</p>
                      <p className="text-[10px] text-muted mb-3">scope_id: {selectedMemory.scope_id} | version: {selectedMemory.version} | {relativeTime(selectedMemory.updated_at)}</p>
                      <div className="rounded-lg border border-border bg-background p-3">
                        <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap">{selectedMemory.value}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Workflows tab */}
            {officeTab === "workflows" && (
              <div className="p-4">
                <div className="rounded-xl border border-border bg-surface/50 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">ID</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">Status</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">Type</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">Start</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: "wf-001", status: "Running", type: "client-onboarding", start: "2 min ago", duration: "2m 14s", statusColor: "#22c55e" },
                        { id: "wf-002", status: "Completed", type: "lead-qualification", start: "15 min ago", duration: "45s", statusColor: "#3b82f6" },
                        { id: "wf-003", status: "Running", type: "memory-store", start: "1h ago", duration: "1h 0m", statusColor: "#22c55e" },
                        { id: "wf-004", status: "Failed", type: "content-generation", start: "3h ago", duration: "12s", statusColor: "#ef4444" },
                        { id: "wf-005", status: "Completed", type: "ticket-resolution", start: "5h ago", duration: "3m 22s", statusColor: "#3b82f6" },
                      ].map((wf) => (
                        <tr key={wf.id} className="border-b border-border/50 hover:bg-hover-bg">
                          <td className="px-4 py-2.5 text-[12px] font-mono text-foreground">{wf.id}</td>
                          <td className="px-4 py-2.5"><span className="rounded px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${wf.statusColor}15`, color: wf.statusColor }}>{wf.status}</span></td>
                          <td className="px-4 py-2.5 text-[12px] text-foreground">{wf.type}</td>
                          <td className="px-4 py-2.5 text-[12px] text-muted">{wf.start}</td>
                          <td className="px-4 py-2.5 text-[12px] text-muted">{wf.duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-center text-[12px] text-muted/60">Connect Temporal Cloud to see live workflows</p>
              </div>
            )}
            </div>

            {/* Live Feed Sidebar */}
            <div className="flex w-[320px] shrink-0 flex-col border-l border-border bg-sidebar-bg">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <h3 className="text-[13px] font-bold text-foreground">Live Feed</h3>
                <div className="ml-auto flex rounded-md border border-border bg-background">
                  {(["all", "message", "task", "approval"] as const).map((f, i) => (
                    <button
                      key={f}
                      onClick={() => setActivityFilter(f)}
                      className={`px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                        activityFilter === f ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
                      } ${i === 0 ? "rounded-l-md" : i === 3 ? "rounded-r-md" : ""}`}
                    >
                      {f === "all" ? "All" : f === "message" ? "Msgs" : f === "task" ? "Tasks" : "Apprvl"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {activityFeed
                  .filter((e) => activityFilter === "all" || e.type === activityFilter)
                  .map((entry, i) => (
                    <div key={`${entry.type}-${entry.id}-${i}`} className="flex gap-2.5 border-b border-border/50 px-4 py-2.5 transition-colors hover:bg-hover-bg">
                      <div className="mt-0.5 shrink-0">
                        {entry.type === "message" && (
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-accent/10">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00d4a8" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          </div>
                        )}
                        {entry.type === "task" && (
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-500/10">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        )}
                        {entry.type === "approval" && (
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-yellow-500/10">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-foreground/80 leading-snug">{entry.description}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          {entry.project_name && (
                            <span className="text-[10px] text-accent">{entry.project_name}</span>
                          )}
                          <span className="text-[10px] text-muted">{relativeTime(entry.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                {activityFeed.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-[13px] text-muted">No activity yet</p>
                    <p className="mt-1 text-[11px] text-muted/60">Events will appear here as you work</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Lab View ── */}
        {viewMode === "lab" && (
          <div className="flex-1 overflow-y-auto p-4">
            {/* Prompt Sandbox */}
            {labTab === "sandbox" && (
              <div className="mx-auto max-w-5xl">
                <div className={labCompareMode ? "grid grid-cols-1 gap-4" : "grid grid-cols-2 gap-4"}>
                  {/* Input panel */}
                  <div className={labCompareMode ? "" : ""}>
                    <div className="rounded-xl border border-border bg-surface/50 p-4">
                      <h4 className="text-[13px] font-bold text-foreground mb-3">Input</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[12px] font-medium text-muted">System Prompt</label>
                          <textarea
                            value={labSystemPrompt}
                            onChange={(e) => setLabSystemPrompt(e.target.value)}
                            placeholder="You are a helpful assistant..."
                            rows={4}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none resize-none focus:border-accent/50"
                          />
                        </div>
                        <div>
                          <label className="text-[12px] font-medium text-muted">User Message</label>
                          <textarea
                            value={labUserMessage}
                            onChange={(e) => setLabUserMessage(e.target.value)}
                            placeholder="Type your test prompt here..."
                            rows={4}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none resize-none focus:border-accent/50"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <label className="text-[12px] font-medium text-muted">Provider</label>
                            <select
                              value={labProvider}
                              onChange={(e) => setLabProvider(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                            >
                              <option value="claude-opus">Claude Opus</option>
                              <option value="claude-sonnet">Claude Sonnet</option>
                              <option value="lmstudio">LM Studio</option>
                              <option value="google">Google Gemini</option>
                              <option value="openai">OpenAI</option>
                            </select>
                          </div>
                          {labCompareMode && (
                            <div className="flex-1">
                              <label className="text-[12px] font-medium text-muted">Provider B</label>
                              <select
                                value={labProviderB}
                                onChange={(e) => setLabProviderB(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                              >
                                <option value="claude-opus">Claude Opus</option>
                                <option value="claude-sonnet">Claude Sonnet</option>
                                <option value="lmstudio">LM Studio</option>
                                <option value="google">Google Gemini</option>
                                <option value="openai">OpenAI</option>
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
                            <input
                              type="checkbox"
                              checked={labCompareMode}
                              onChange={(e) => setLabCompareMode(e.target.checked)}
                              className="accent-accent"
                            />
                            Compare Mode
                          </label>
                          <button
                            onClick={runLabPrompt}
                            disabled={labRunning || !labUserMessage.trim()}
                            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30"
                          >
                            {labRunning ? (
                              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"/>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            )}
                            {labRunning ? "Running..." : "Run"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Result panel(s) */}
                  {!labCompareMode ? (
                    <div className="rounded-xl border border-border bg-surface/50 p-4">
                      <h4 className="text-[13px] font-bold text-foreground mb-3">Result</h4>
                      {labResult ? (
                        labResult.error ? (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                            <p className="text-[13px] text-red-400">{labResult.error}</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{labResult.provider}</span>
                              <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted">{(labResult.latency / 1000).toFixed(1)}s</span>
                              <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted">{labResult.inputTokens} in / {labResult.outputTokens} out</span>
                              <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted">~${labResult.cost}</span>
                            </div>
                            <div className="rounded-lg border border-border bg-background p-3">
                              <div className="msg-content text-[13px] leading-relaxed text-foreground/90">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{labResult.text}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          </div>
                          <p className="text-[13px] text-muted">Run a prompt to see results</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Compare mode: two result panels side by side */
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: "Provider A", result: labResult, provider: labProvider },
                        { label: "Provider B", result: labResultB, provider: labProviderB },
                      ].map((panel) => (
                        <div key={panel.label} className="rounded-xl border border-border bg-surface/50 p-4">
                          <h4 className="text-[13px] font-bold text-foreground mb-3">{panel.label}</h4>
                          {panel.result ? (
                            panel.result.error ? (
                              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                                <p className="text-[13px] text-red-400">{panel.result.error}</p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                  <span className="rounded bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{panel.result.provider}</span>
                                  <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted">{(panel.result.latency / 1000).toFixed(1)}s</span>
                                  <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted">~${panel.result.cost}</span>
                                </div>
                                <div className="rounded-lg border border-border bg-background p-3">
                                  <div className="msg-content text-[13px] leading-relaxed text-foreground/90">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{panel.result.text}</ReactMarkdown>
                                  </div>
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                              <p className="text-[12px] text-muted">{labRunning ? "Running..." : "Waiting for run"}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Skill Editor */}
            {labTab === "skills" && (
              <div className="mx-auto max-w-4xl">
                <div className="grid grid-cols-3 gap-4">
                  {/* Skill list */}
                  <div className="rounded-xl border border-border bg-surface/50 p-4">
                    <h4 className="text-[13px] font-bold text-foreground mb-3">
                      Skills — {activeInfo.name}
                    </h4>
                    {skills.length === 0 ? (
                      <p className="text-[12px] text-muted py-4 text-center">No skills in active project</p>
                    ) : (
                      <div className="space-y-1.5">
                        {skills.map((skill) => (
                          <button
                            key={skill.id}
                            onClick={() => setLabEditingSkill({ ...skill })}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                              labEditingSkill?.id === skill.id ? "bg-accent/15 border border-accent/30" : "border border-border hover:bg-hover-bg"
                            }`}
                          >
                            <span className={`h-2 w-2 rounded-full shrink-0 ${skill.active ? "bg-green-500" : "bg-zinc-600"}`} />
                            <span className="text-[12px] font-medium text-foreground truncate">{skill.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Skill content editor */}
                  <div className="col-span-2 rounded-xl border border-border bg-surface/50 p-4">
                    {labEditingSkill ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[13px] font-bold text-foreground">Editing: {labEditingSkill.name}</h4>
                          <button
                            onClick={() => testSkillWithDrew(labEditingSkill)}
                            disabled={labRunning}
                            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-30"
                          >
                            {labRunning ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"/>
                            ) : (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            )}
                            Test with Drew
                          </button>
                        </div>
                        <textarea
                          value={labEditingSkill.content}
                          onChange={(e) => setLabEditingSkill({ ...labEditingSkill, content: e.target.value })}
                          rows={12}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none focus:border-accent/50 font-mono"
                        />
                        {/* Preview: how it looks in system prompt */}
                        <div>
                          <p className="text-[11px] font-medium text-muted mb-1">Preview in Drew&apos;s system prompt:</p>
                          <div className="rounded-lg border border-border bg-background p-3 text-[11px] text-muted font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {`### Skill: ${labEditingSkill.name}\n${labEditingSkill.content}`}
                          </div>
                        </div>
                        {/* Test result */}
                        {labResult && (
                          <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[11px] font-bold text-accent">Test Result</span>
                              {labResult.latency > 0 && (
                                <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">{(labResult.latency / 1000).toFixed(1)}s</span>
                              )}
                            </div>
                            <div className="msg-content text-[12px] leading-relaxed text-foreground/80">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{labResult.text}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <p className="text-[13px] text-muted">Select a skill to edit and test</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Spawn Tester (placeholder) */}
            {labTab === "spawn" && (
              <div className="mx-auto max-w-3xl">
                <div className="rounded-xl border border-border bg-surface/50 p-6">
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/10">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                        <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                      </svg>
                    </div>
                    <h4 className="text-[16px] font-bold text-foreground">Spawn Tester</h4>
                    <p className="mt-2 max-w-md text-[13px] text-muted">
                      Define worker templates, test runs, and view logs. This feature will become fully functional when Temporal workflows are connected.
                    </p>
                    <div className="mt-6 w-full max-w-md space-y-3">
                      <div>
                        <label className="text-[12px] font-medium text-muted">Worker Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Research Agent"
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none"
                          disabled
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[12px] font-medium text-muted">Role</label>
                          <input
                            type="text"
                            placeholder="Builder"
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none"
                            disabled
                          />
                        </div>
                        <div>
                          <label className="text-[12px] font-medium text-muted">Model</label>
                          <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none" disabled>
                            <option>Claude Sonnet</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted">System Prompt</label>
                        <textarea
                          placeholder="Worker instructions..."
                          rows={4}
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none resize-none"
                          disabled
                        />
                      </div>
                      <button
                        className="w-full rounded-lg bg-purple-600/50 px-4 py-2 text-[13px] font-medium text-white/50 cursor-not-allowed"
                        disabled
                      >
                        Test Run (Coming with Temporal)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Board View ── */}
        {viewMode === "board" && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-foreground">Task Board</h3>
              <button
                onClick={() => setShowAddTask(true)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Task
              </button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-4">
              {BOARD_COLUMNS.map((col) => {
                const colTasks = tasks.filter((t) => t.status === col.key);
                return (
                  <div
                    key={col.key}
                    className={`flex w-[240px] shrink-0 flex-col rounded-lg border bg-surface/50 transition-colors ${dragOverColumn === col.key ? "border-accent/50 bg-accent/5" : "border-border"}`}
                    onDragOver={(e) => handleDragOver(e, col.key)}
                    onDragLeave={handleDragLeave}
                    onDrop={() => handleDrop(col.key)}
                  >
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} />
                      <span className="text-[12px] font-semibold text-foreground">{col.label}</span>
                      <span className="ml-auto rounded bg-background px-1.5 py-px text-[10px] font-medium text-muted">{colTasks.length}</span>
                    </div>
                    <div className="flex-1 space-y-1.5 px-2 pb-2">
                      {colTasks.map((task) => (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={() => handleDragStart(task.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => setEditingTask({ ...task })}
                          className={`group cursor-pointer rounded-md border border-border bg-background p-2.5 transition-all hover:border-accent/30 ${draggedTaskId === task.id ? "opacity-40 scale-95" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteTask(task.id); showToast("Task deleted"); }}
                              className="shrink-0 opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded text-muted hover:text-red-400 transition-all"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                          {task.description && (
                            <p className="mt-1 text-[11px] text-muted line-clamp-2">{task.description}</p>
                          )}
                          <div className="mt-2 flex items-center gap-1.5">
                            <span
                              className="rounded px-1.5 py-px text-[9px] font-bold uppercase"
                              style={{ backgroundColor: `${PRIORITY_COLORS[task.priority]}20`, color: PRIORITY_COLORS[task.priority] }}
                            >
                              {task.priority}
                            </span>
                            {task.assignee && (
                              <span className="rounded bg-surface px-1.5 py-px text-[10px] text-muted">{task.assignee}</span>
                            )}
                            {task.due_date && (
                              <span className="ml-auto text-[10px] text-muted">{formatDateShort(task.due_date)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                      {colTasks.length === 0 && (
                        <div className={`rounded-md border border-dashed py-6 text-center text-[11px] text-muted transition-colors ${dragOverColumn === col.key ? "border-accent/40 text-accent" : "border-border/50"}`}>
                          {dragOverColumn === col.key ? "Drop here" : "No tasks"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Settings View ── */}
        {viewMode === "settings" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl">
              <h3 className="text-xl font-bold text-foreground">Settings</h3>
              <p className="mt-1 text-[13px] text-muted">Configure your brain, providers, and integrations.</p>

              {/* ── Brain Configuration ── */}
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  </div>
                  <div>
                    <h4 className="text-[14px] font-semibold text-foreground">Brain</h4>
                    <p className="text-[11px] text-muted">Drew&apos;s model, thinking budget, and failover chain</p>
                  </div>
                </div>
                <div className="space-y-4 rounded-lg border border-border bg-surface/50 p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[12px] font-medium text-muted">Brain Model</label>
                      <select
                        defaultValue={globalSettings.brain_model || "claude-opus-4-6"}
                        onChange={(e) => saveGlobalSettings({ brain_model: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                      >
                        <option value="claude-opus-4-6">Claude Opus 4.6</option>
                        <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[12px] font-medium text-muted">Thinking Budget</label>
                      <select
                        defaultValue={globalSettings.thinking_budget || "5000"}
                        onChange={(e) => saveGlobalSettings({ thinking_budget: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                      >
                        <option value="2000">Light (2k tokens)</option>
                        <option value="5000">Standard (5k tokens)</option>
                        <option value="10000">Deep (10k tokens)</option>
                        <option value="20000">Maximum (20k tokens)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-muted">Worker Failover Chain</label>
                    <p className="text-[10px] text-muted/70">When LM Studio is unavailable, workers fall back to:</p>
                    <select
                      defaultValue={globalSettings.default_worker_provider || "claude-sonnet"}
                      onChange={(e) => saveGlobalSettings({ default_worker_provider: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                    >
                      <option value="claude-sonnet">Claude Sonnet 4.6</option>
                      <option value="google">Google Gemini</option>
                      <option value="openai">OpenAI GPT-4o</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* ── API Keys ── */}
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-500"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                  </div>
                  <div>
                    <h4 className="text-[14px] font-semibold text-foreground">API Keys</h4>
                    <p className="text-[11px] text-muted">Provider credentials — stored locally, never shared</p>
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
                  {[
                    { key: "anthropic_api_key", label: "Anthropic", placeholder: "sk-ant-...", hint: "Claude Opus & Sonnet" },
                    { key: "google_api_key", label: "Google AI", placeholder: "AIza...", hint: "Gemini models" },
                    { key: "openai_api_key", label: "OpenAI", placeholder: "sk-...", hint: "GPT models, Whisper, TTS" },
                  ].map((provider) => (
                    <div key={provider.key} className="flex items-center gap-3">
                      <div className="w-20 shrink-0">
                        <p className="text-[12px] font-medium text-foreground">{provider.label}</p>
                        <p className="text-[10px] text-muted">{provider.hint}</p>
                      </div>
                      <input
                        type="password"
                        defaultValue={globalSettings[provider.key] || ""}
                        placeholder={provider.placeholder}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (globalSettings[provider.key] || "")) {
                            saveGlobalSettings({ [provider.key]: val });
                          }
                        }}
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder-muted outline-none focus:border-accent/50"
                      />
                      <span className={`h-2 w-2 rounded-full shrink-0 ${globalSettings[provider.key] ? "bg-green-500" : "bg-border"}`} title={globalSettings[provider.key] ? "Configured" : "Not set"} />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── LM Studio / Local LLM ── */}
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  </div>
                  <div>
                    <h4 className="text-[14px] font-semibold text-foreground">LM Studio / Local LLM</h4>
                    <p className="text-[11px] text-muted">Connect to LM Studio on this machine or a remote one</p>
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
                  <div>
                    <label className="text-[12px] font-medium text-muted">Server URL</label>
                    <input
                      type="text"
                      defaultValue={globalSettings.lm_studio_url || ""}
                      placeholder="http://192.168.1.100:1234/v1"
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val !== (globalSettings.lm_studio_url || "")) {
                          saveGlobalSettings({ lm_studio_url: val });
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none focus:border-accent/50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] font-medium text-muted">Google Model</label>
                      <select
                        defaultValue={globalSettings.google_model || "gemini-2.0-flash"}
                        onChange={(e) => saveGlobalSettings({ google_model: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                      >
                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                        <option value="gemini-2.5-pro-preview-06-05">Gemini 2.5 Pro</option>
                        <option value="gemini-2.5-flash-preview-05-20">Gemini 2.5 Flash</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[12px] font-medium text-muted">OpenAI Model</label>
                      <select
                        defaultValue={globalSettings.openai_model || "gpt-4o"}
                        onChange={(e) => saveGlobalSettings({ openai_model: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                      >
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="gpt-4.1">GPT-4.1</option>
                        <option value="o3-mini">o3-mini</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Integrations ── */}
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-400"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  </div>
                  <div>
                    <h4 className="text-[14px] font-semibold text-foreground">Integrations</h4>
                    <p className="text-[11px] text-muted">Connect external services</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { name: "Salesforce", status: "available", icon: "CRM" },
                    { name: "Slack", status: "available", icon: "MSG" },
                    { name: "Temporal Cloud", status: "available", icon: "WF" },
                    { name: "VAPI Voice", status: "available", icon: "VOX" },
                  ].map((integration) => (
                    <div key={integration.name} className="flex items-center gap-3 rounded-lg border border-border bg-surface/50 p-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background text-[10px] font-bold text-muted">
                        {integration.icon}
                      </div>
                      <div className="flex-1">
                        <p className="text-[13px] font-medium text-foreground">{integration.name}</p>
                        <p className="text-[10px] text-muted">Not connected</p>
                      </div>
                      <button className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground hover:border-accent/30">
                        Connect
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Memory ── */}
              <div className="mt-8 mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                  </div>
                  <div>
                    <h4 className="text-[14px] font-semibold text-foreground">Memory & Context</h4>
                    <p className="text-[11px] text-muted">How Drew retains context across sessions</p>
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
                  <div>
                    <label className="text-[12px] font-medium text-muted">Memory Backend</label>
                    <select
                      defaultValue={globalSettings.memory_backend || "postgres"}
                      onChange={(e) => saveGlobalSettings({ memory_backend: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                    >
                      <option value="postgres">PostgreSQL (Local)</option>
                      <option value="temporal">Temporal Cloud (Durable)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-muted">Context Window</label>
                    <select
                      defaultValue={globalSettings.context_messages || "20"}
                      onChange={(e) => saveGlobalSettings({ context_messages: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"
                    >
                      <option value="10">Last 10 messages</option>
                      <option value="20">Last 20 messages</option>
                      <option value="50">Last 50 messages</option>
                      <option value="100">Last 100 messages</option>
                    </select>
                  </div>
                </div>
              </div>

              {settingsSaving && (
                <div className="fixed bottom-6 right-6 rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-white shadow-lg">
                  Saving...
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Files View ── */}
        {viewMode === "files" && (
          <div className="flex-1 overflow-y-auto p-6"
            onDragOver={(e) => { e.preventDefault(); setDragOverFiles(true); }}
            onDragLeave={() => setDragOverFiles(false)}
            onDrop={(e) => { e.preventDefault(); handleFileUpload(e.dataTransfer.files); }}
          >
            <div className="mx-auto max-w-4xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">Files</h3>
                  <p className="mt-1 text-[13px] text-muted">All files across your projects.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    {uploadingFile ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </div>

              {/* Drop zone overlay */}
              {dragOverFiles && (
                <div className="mt-4 flex items-center justify-center rounded-xl border-2 border-dashed border-accent/50 bg-accent/5 p-12">
                  <div className="text-center">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-accent">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <p className="mt-2 text-[14px] font-medium text-accent">Drop files here</p>
                  </div>
                </div>
              )}

              {!dragOverFiles && projectFiles.length === 0 ? (
                <div className="mt-8 flex flex-col items-center rounded-xl border-2 border-dashed border-border p-12 text-center cursor-pointer hover:border-accent/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-muted/30">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <p className="mt-3 text-[14px] text-muted">No files yet</p>
                  <p className="mt-1 text-[12px] text-muted/60">Click or drag and drop files here to upload.</p>
                </div>
              ) : !dragOverFiles && (
                <div className="mt-6 overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-border bg-surface">
                      <tr>
                        <th className="px-4 py-2.5 font-medium text-muted">Name</th>
                        <th className="px-4 py-2.5 font-medium text-muted">Project</th>
                        <th className="px-4 py-2.5 font-medium text-muted">Type</th>
                        <th className="px-4 py-2.5 font-medium text-muted">Size</th>
                        <th className="px-4 py-2.5 font-medium text-muted">By</th>
                        <th className="px-4 py-2.5 font-medium text-muted">Uploaded</th>
                        <th className="px-4 py-2.5 font-medium text-muted w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectFiles.map((file) => (
                        <tr key={file.id} className="border-b border-border last:border-0 hover:bg-hover-bg transition-colors">
                          <td className="px-4 py-2.5 text-foreground font-medium">
                            <div className="flex items-center gap-2">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted shrink-0">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                              </svg>
                              {file.name}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-muted">{file.project_name || file.channel_id}</td>
                          <td className="px-4 py-2.5"><span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted">{file.file_type}</span></td>
                          <td className="px-4 py-2.5 text-muted">{file.file_size > 1024 * 1024 ? `${(file.file_size / 1024 / 1024).toFixed(1)} MB` : file.file_size > 1024 ? `${(file.file_size / 1024).toFixed(0)} KB` : `${file.file_size} B`}</td>
                          <td className="px-4 py-2.5 text-muted text-[12px]">{file.uploaded_by?.split("@")[0] || "-"}</td>
                          <td className="px-4 py-2.5 text-muted text-[12px]">{new Date(file.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => handleDeleteFile(file.id)} className="text-muted hover:text-red-400" title="Delete">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Admin View ── */}
        {viewMode === "admin" && session?.user?.role === "admin" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-5xl">
              <h3 className="text-xl font-bold text-foreground">Admin</h3>
              <p className="mt-1 text-[13px] text-muted">Manage users, monitor usage, and view system health.</p>

              {/* Admin tabs */}
              <div className="mt-6 flex gap-1 rounded-lg bg-surface p-1">
                {(["users", "workspaces", "usage", "audit", "system"] as const).map((tab) => (
                  <button key={tab} onClick={() => { setAdminTab(tab); if (tab === "audit") loadAdminAudit(); if (tab === "usage") loadAdminUsage(); if (tab === "system") loadAdminSystem(); }}
                    className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition-colors ${adminTab === tab ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>
                    {tab}
                  </button>
                ))}
              </div>

              {/* Users tab */}
              {adminTab === "users" && (
                <div className="mt-6">
                  {/* Invite form */}
                  <div className="mb-6 rounded-xl border border-border bg-surface p-4">
                    <h4 className="text-[14px] font-semibold text-foreground mb-3">Invite User</h4>
                    <div className="flex gap-2 items-end flex-wrap">
                      <div className="flex-1 min-w-[140px]">
                        <label className="text-[11px] font-medium text-muted">Name</label>
                        <input type="text" value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none" placeholder="Jane Doe"/>
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="text-[11px] font-medium text-muted">Email</label>
                        <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none" placeholder="jane@company.com"/>
                      </div>
                      <div className="w-28">
                        <label className="text-[11px] font-medium text-muted">Role</label>
                        <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none">
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </div>
                      <button onClick={handleInviteUser} disabled={!inviteForm.name.trim() || !inviteForm.email.trim()} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30">Invite</button>
                    </div>
                    {inviteResult && (
                      <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
                        <p className="text-[13px] text-foreground">Invited <strong>{inviteResult.email}</strong></p>
                        <p className="mt-1 text-[13px] text-muted">Temporary password: <code className="rounded bg-surface px-2 py-0.5 text-accent font-mono select-all">{inviteResult.temporaryPassword}</code></p>
                        <p className="mt-1 text-[11px] text-muted">Share this password securely with the user.</p>
                      </div>
                    )}
                  </div>

                  {/* Users table */}
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-b border-border bg-surface">
                        <tr>
                          <th className="px-4 py-2.5 font-medium text-muted">Name</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Email</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Role</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Status</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Last Login</th>
                          <th className="px-4 py-2.5 font-medium text-muted w-20">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.map((u) => (
                          <tr key={u.id} className="border-b border-border last:border-0 hover:bg-hover-bg transition-colors">
                            <td className="px-4 py-2.5 text-foreground font-medium">{u.name}</td>
                            <td className="px-4 py-2.5 text-muted">{u.email}</td>
                            <td className="px-4 py-2.5">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u.role === "admin" ? "bg-accent/15 text-accent" : u.role === "viewer" ? "bg-yellow-500/15 text-yellow-500" : "bg-blue-500/15 text-blue-400"}`}>
                                {u.role || (u.is_admin ? "admin" : "member")}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[12px] ${u.status === "active" ? "text-green-500" : u.status === "deactivated" ? "text-red-400" : "text-yellow-500"}`}>{u.status || "active"}</span>
                            </td>
                            <td className="px-4 py-2.5 text-muted text-[12px]">{u.last_login_at ? relativeTime(u.last_login_at) : "Never"}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex gap-1">
                                <select value={u.role || (u.is_admin ? "admin" : "member")} onChange={(e) => handleUpdateUserRole(u.id, e.target.value)} className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none">
                                  <option value="member">Member</option>
                                  <option value="admin">Admin</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                                {u.email !== session?.user?.email && (
                                  <button onClick={() => handleDeleteUser(u.id)} className="text-muted hover:text-red-400" title="Delete user">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Workspaces tab */}
              {adminTab === "workspaces" && (
                <div className="mt-6">
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-b border-border bg-surface">
                        <tr>
                          <th className="px-4 py-2.5 font-medium text-muted">Name</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Members</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaces.map((ws) => (
                          <tr key={ws.id} className="border-b border-border last:border-0 hover:bg-hover-bg transition-colors">
                            <td className="px-4 py-2.5 text-foreground font-medium">{ws.name}</td>
                            <td className="px-4 py-2.5 text-muted">{ws.member_count}</td>
                            <td className="px-4 py-2.5 text-muted text-[12px]">{ws.id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Usage tab */}
              {adminTab === "usage" && (
                <div className="mt-6">
                  {/* 24h KPI cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    {["llm_tokens", "messages", "api_calls", "voice_minutes"].map((type) => {
                      const val = adminUsage?.totals24h.find((t) => t.usage_type === type);
                      const labels: Record<string, string> = { llm_tokens: "Tokens (24h)", messages: "Messages (24h)", api_calls: "API Calls (24h)", voice_minutes: "Voice Min (24h)" };
                      return (
                        <div key={type} className="rounded-xl border border-border bg-surface p-4">
                          <p className="text-[11px] font-medium text-muted uppercase">{labels[type]}</p>
                          <p className="mt-1 text-2xl font-bold text-foreground">{val ? Number(val.total).toLocaleString() : "0"}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* By model */}
                  {adminUsage?.byModel && adminUsage.byModel.length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-[14px] font-semibold text-foreground mb-3">Usage by Model (7d)</h4>
                      <div className="overflow-hidden rounded-xl border border-border">
                        <table className="w-full text-left text-[13px]">
                          <thead className="border-b border-border bg-surface">
                            <tr><th className="px-4 py-2.5 font-medium text-muted">Model</th><th className="px-4 py-2.5 font-medium text-muted">Tokens</th></tr>
                          </thead>
                          <tbody>
                            {adminUsage.byModel.map((m, i) => (
                              <tr key={i} className="border-b border-border last:border-0 hover:bg-hover-bg"><td className="px-4 py-2.5 text-foreground">{m.model}</td><td className="px-4 py-2.5 text-muted">{Number(m.total).toLocaleString()}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* By user */}
                  {adminUsage?.byUser && adminUsage.byUser.length > 0 && (
                    <div>
                      <h4 className="text-[14px] font-semibold text-foreground mb-3">Usage by User (7d)</h4>
                      <div className="overflow-hidden rounded-xl border border-border">
                        <table className="w-full text-left text-[13px]">
                          <thead className="border-b border-border bg-surface">
                            <tr><th className="px-4 py-2.5 font-medium text-muted">User</th><th className="px-4 py-2.5 font-medium text-muted">Type</th><th className="px-4 py-2.5 font-medium text-muted">Amount</th></tr>
                          </thead>
                          <tbody>
                            {adminUsage.byUser.map((u, i) => (
                              <tr key={i} className="border-b border-border last:border-0 hover:bg-hover-bg"><td className="px-4 py-2.5 text-foreground">{u.user_email}</td><td className="px-4 py-2.5 text-muted">{u.usage_type}</td><td className="px-4 py-2.5 text-muted">{Number(u.total).toLocaleString()}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Audit tab */}
              {adminTab === "audit" && (
                <div className="mt-6">
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-[13px]">
                      <thead className="border-b border-border bg-surface">
                        <tr>
                          <th className="px-4 py-2.5 font-medium text-muted">Time</th>
                          <th className="px-4 py-2.5 font-medium text-muted">User</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Action</th>
                          <th className="px-4 py-2.5 font-medium text-muted">Resource</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminAudit.entries.map((entry) => (
                          <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-hover-bg transition-colors">
                            <td className="px-4 py-2.5 text-muted text-[12px] whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-foreground">{entry.user_email}</td>
                            <td className="px-4 py-2.5"><span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-accent">{entry.action}</span></td>
                            <td className="px-4 py-2.5 text-muted">{entry.resource_type}{entry.resource_id ? `: ${entry.resource_id}` : ""}</td>
                          </tr>
                        ))}
                        {adminAudit.entries.length === 0 && (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No audit events yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {adminAudit.totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <button onClick={() => loadAdminAudit(adminAudit.page - 1)} disabled={adminAudit.page <= 1} className="rounded-lg border border-border px-3 py-1 text-[12px] text-muted hover:text-foreground disabled:opacity-30">Prev</button>
                      <span className="text-[12px] text-muted">Page {adminAudit.page} of {adminAudit.totalPages}</span>
                      <button onClick={() => loadAdminAudit(adminAudit.page + 1)} disabled={adminAudit.page >= adminAudit.totalPages} className="rounded-lg border border-border px-3 py-1 text-[12px] text-muted hover:text-foreground disabled:opacity-30">Next</button>
                    </div>
                  )}
                </div>
              )}

              {/* System tab */}
              {adminTab === "system" && adminSystem && (
                <div className="mt-6 space-y-6">
                  {/* Server info */}
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <h4 className="text-[14px] font-semibold text-foreground mb-3">Server</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
                      <div><p className="text-muted">Node</p><p className="text-foreground font-medium">{adminSystem.server.nodeVersion}</p></div>
                      <div><p className="text-muted">Platform</p><p className="text-foreground font-medium">{adminSystem.server.platform}</p></div>
                      <div><p className="text-muted">Uptime</p><p className="text-foreground font-medium">{Math.floor(adminSystem.server.uptime / 60)}m</p></div>
                      <div><p className="text-muted">Heap</p><p className="text-foreground font-medium">{(adminSystem.server.memoryUsage.heapUsed / 1024 / 1024).toFixed(0)} MB / {(adminSystem.server.memoryUsage.heapTotal / 1024 / 1024).toFixed(0)} MB</p></div>
                    </div>
                  </div>

                  {/* DB pool */}
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <h4 className="text-[14px] font-semibold text-foreground mb-3">Database Pool</h4>
                    <div className="grid grid-cols-3 gap-4 text-[13px]">
                      <div><p className="text-muted">Total</p><p className="text-foreground font-medium">{adminSystem.pool.totalCount}</p></div>
                      <div><p className="text-muted">Idle</p><p className="text-foreground font-medium">{adminSystem.pool.idleCount}</p></div>
                      <div><p className="text-muted">Waiting</p><p className="text-foreground font-medium">{adminSystem.pool.waitingCount}</p></div>
                    </div>
                  </div>

                  {/* Table counts */}
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <h4 className="text-[14px] font-semibold text-foreground mb-3">Table Row Counts</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[13px]">
                      {Object.entries(adminSystem.tableCounts).map(([table, count]) => (
                        <div key={table} className="flex items-center justify-between rounded-lg bg-background px-3 py-2">
                          <span className="text-muted">{table}</span>
                          <span className="font-medium text-foreground">{count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Chat View ── */}
        {viewMode === "chat" && (
        <>
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !typingAgent && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center px-4">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
                  <span className="text-2xl font-bold text-accent">D</span>
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  {getGreeting()}, Andrew.
                </h2>
                <p className="mt-2 max-w-md text-[14px] text-muted">
                  I&apos;m Drew, your AI brain for <span className="text-foreground font-medium">{activeInfo.name}</span>. Ask me anything or tell me what to work on.
                </p>
              </div>
            </div>
          )}

          <div className="px-4 pb-4">
            {messages.map((msg, i) => {
              const prev = i > 0 ? messages[i - 1] : null;
              const grouped = shouldGroup(prev, msg);
              const showDate = !prev || isDifferentDay(prev.created_at, msg.created_at);
              const isHuman = msg.sender_type === "human";
              const color = isHuman ? "#3b82f6" : drewMeta.color;
              const hasReasoning = !!msg.reasoning;
              const isExpanded = expandedReasoning.has(msg.id);
              const isHovered = hoveredMsg === msg.id;

              return (
                <div key={msg.id}>
                  {/* Date divider */}
                  {showDate && (
                    <div className="my-4 flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <span className="rounded-full border border-border bg-background px-3 py-0.5 text-[11px] font-semibold text-muted">
                        {formatDate(msg.created_at)}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}

                  {/* Message row */}
                  <div
                    className={`group relative flex gap-2 rounded-lg px-2 py-0.5 transition-colors hover:bg-hover-bg ${grouped ? "" : "mt-3"}`}
                    onMouseEnter={() => setHoveredMsg(msg.id)}
                    onMouseLeave={() => setHoveredMsg(null)}
                  >
                    {/* Avatar column */}
                    <div className="w-9 shrink-0 pt-0.5">
                      {!grouped && (
                        isHuman ? (
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">A</div>
                        ) : (
                          <div
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white"
                            style={{ backgroundColor: drewMeta.color }}
                          >
                            D
                          </div>
                        )
                      )}
                    </div>

                    {/* Content column */}
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <div className="flex items-baseline gap-2">
                          <span className={`text-[15px] font-bold ${isHuman ? "text-foreground" : ""}`} style={!isHuman ? { color } : undefined}>
                            {isHuman ? "You" : "Drew"}
                          </span>
                          {!isHuman && (
                            <span className="rounded bg-surface px-1 py-px text-[10px] font-medium text-muted">Brain</span>
                          )}
                          <span className="text-[11px] text-muted">{formatTime(msg.created_at)}</span>
                        </div>
                      )}

                      {/* Reasoning */}
                      {hasReasoning && (
                        <>
                          <button
                            onClick={() => toggleReasoning(msg.id)}
                            className="mt-0.5 flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-accent"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                              className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                              <polyline points="9 18 15 12 9 6"/>
                            </svg>
                            reasoning
                          </button>
                          {isExpanded && (
                            <div className="mt-1 rounded-md border border-border bg-sidebar-bg px-3 py-2 text-[12px] leading-relaxed text-muted">
                              {msg.reasoning}
                            </div>
                          )}
                        </>
                      )}

                      {/* Message content */}
                      <div className="msg-content text-[15px] leading-[1.46] text-foreground/90">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>

                      {/* Approval card */}
                      {msg.approval_id && (
                        <div className="mt-2 max-w-md rounded-lg border border-accent/30 bg-accent/5 p-3">
                          <div className="flex items-center gap-2">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00d4a8" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-accent">Approval Required</span>
                            {msg.approval_status !== "pending" && (
                              <span className={`rounded px-1.5 py-px text-[10px] font-bold ${
                                msg.approval_status === "approved" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                              }`}>
                                {msg.approval_status?.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[13px] font-medium text-foreground">{msg.approval_title}</p>
                          {msg.approval_description && (
                            <p className="mt-0.5 text-[12px] text-muted">{msg.approval_description}</p>
                          )}
                          {msg.approval_status === "pending" && (
                            <div className="mt-2.5 flex gap-2">
                              <button
                                onClick={() => handleApproval(msg.approval_id!, "approved")}
                                className="rounded-md bg-green-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-green-700"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleApproval(msg.approval_id!, "rejected")}
                                className="rounded-md border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted hover:text-foreground"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          {msg.resolved_by && (
                            <p className="mt-1.5 text-[10px] text-muted">
                              {msg.approval_status === "approved" ? "Approved" : "Rejected"} by {msg.resolved_by}
                              {msg.resolved_at && ` at ${formatTime(msg.resolved_at)}`}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Hover actions toolbar */}
                    {isHovered && (
                      <div className="absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border border-border bg-surface px-1 py-0.5 shadow-lg">
                        {grouped && (
                          <span className="px-1.5 text-[10px] text-muted">{formatTime(msg.created_at)}</span>
                        )}
                        {!isHuman && (
                          <button
                            onClick={() => playTTS(msg)}
                            className={`flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-hover-bg hover:text-foreground ${playingTTS === msg.id ? "text-accent" : ""}`}
                            title="Listen"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {typingAgent && (
              <div className="mt-2 flex items-center gap-2 px-2 py-1">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white"
                  style={{ backgroundColor: drewMeta.color }}
                >
                  D
                </div>
                <div>
                  <span className="text-[13px] font-bold" style={{ color: drewMeta.color }}>
                    Drew
                  </span>
                  <span className="ml-1.5 text-[13px] text-muted">is thinking</span>
                  <span className="ml-0.5 inline-flex gap-px">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted" style={{ animationDelay: "0ms" }}/>
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted" style={{ animationDelay: "150ms" }}/>
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted" style={{ animationDelay: "300ms" }}/>
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input bar */}
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-border bg-surface">
            {/* Toolbar row */}
            <div className="flex items-center gap-1 border-b border-border/50 px-3 py-1">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => recording && stopRecording()}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={sending || transcribing}
                className={`flex h-7 w-7 items-center justify-center rounded transition-all ${
                  recording ? "bg-red-500 text-white" : transcribing ? "text-accent" : "text-muted hover:bg-hover-bg hover:text-foreground"
                }`}
                title="Hold to speak"
              >
                {transcribing ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent"/>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                )}
              </button>
              {recording && (
                <span className="flex items-center gap-1.5 text-[11px] text-red-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"/>
                  Recording...
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                {activeSkillCount > 0 && (
                  <button
                    onClick={() => setSkillsPanelOpen(true)}
                    className="flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/20"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    {activeSkillCount} skill{activeSkillCount !== 1 ? "s" : ""} active
                  </button>
                )}
                <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted">{activeInfo.name}</span>
              </div>
            </div>

            {/* Audio note preview */}
            {audioNoteBlob && (
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 bg-accent/5">
                <div className="flex items-center gap-1">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg>
                  <span className="text-[12px] text-accent font-medium">Audio note ready</span>
                </div>
                <div className="flex-1"/>
                <button onClick={discardAudioNote} className="text-[11px] text-muted hover:text-foreground">Discard</button>
                <button onClick={sendAudioNote} disabled={sending} className="rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-30">Send</button>
              </div>
            )}

            {/* Text input */}
            <div className="flex items-end gap-1.5 px-3 py-2">
              {/* Emoji picker button */}
              <div className="relative mb-0.5">
                <button
                  onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover-bg hover:text-foreground"
                  title="Emoji"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                </button>
                {emojiPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setEmojiPickerOpen(false)}/>
                    <div className="absolute bottom-10 left-0 z-50">
                      <Picker data={data} onEmojiSelect={(emoji: { native: string }) => { setInput((prev) => prev + emoji.native); setEmojiPickerOpen(false); inputRef.current?.focus(); }} theme="dark" previewPosition="none" skinTonePosition="none" />
                    </div>
                  </>
                )}
              </div>

              {/* Audio note button */}
              <button
                onMouseDown={recordingAudioNote ? undefined : startAudioNote}
                onMouseUp={recordingAudioNote ? stopAudioNote : undefined}
                onMouseLeave={() => recordingAudioNote && stopAudioNote()}
                onTouchStart={recordingAudioNote ? undefined : startAudioNote}
                onTouchEnd={recordingAudioNote ? stopAudioNote : undefined}
                disabled={sending || transcribing}
                className={`mb-0.5 flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  recordingAudioNote ? "bg-red-500 text-white" : "text-muted hover:bg-hover-bg hover:text-foreground"
                }`}
                title="Hold to record audio note"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>

              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder={
                  recordingAudioNote ? "Recording audio note..." :
                  recording ? "Listening..." :
                  transcribing ? "Transcribing..." :
                  "Ask Drew anything..."
                }
                disabled={sending || recording || transcribing || recordingAudioNote}
                rows={1}
                className="flex-1 resize-none bg-transparent text-[15px] text-foreground placeholder-muted outline-none disabled:opacity-50"
                style={{ minHeight: "24px", maxHeight: "120px" }}
                autoFocus
              />
              <button
                onClick={() => handleSend()}
                disabled={sending || !input.trim()}
                className="mb-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white transition-opacity hover:opacity-90 disabled:opacity-20"
              >
                {sending ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"/>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        </>
        )}{/* end chat view */}
        </div>{/* end content column */}

        {/* ── Skills Panel ── */}
        {skillsPanelOpen && (viewMode === "chat" || viewMode === "board") && (
          <div className="flex w-[320px] shrink-0 flex-col border-l border-border bg-sidebar-bg">
            <div className="flex h-[49px] items-center justify-between border-b border-border px-4">
              <h3 className="text-[14px] font-bold text-foreground">Skills</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowAddSkill(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  title="Add skill"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button
                  onClick={() => setSkillsPanelOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {skills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                  </div>
                  <p className="text-[13px] font-medium text-foreground">No skills yet</p>
                  <p className="mt-1 text-[12px] text-muted">Add skills to give Drew project-specific context.</p>
                  <button
                    onClick={() => setShowAddSkill(true)}
                    className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
                  >
                    Add First Skill
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {skills.map((skill) => (
                    <div
                      key={skill.id}
                      className={`rounded-lg border p-3 transition-colors ${
                        skill.active ? "border-accent/30 bg-accent/5" : "border-border bg-surface"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={`text-[13px] font-medium ${skill.active ? "text-foreground" : "text-muted"}`}>
                            {skill.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted line-clamp-2">
                            {skill.content.slice(0, 120)}{skill.content.length > 120 ? "..." : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => toggleSkill(skill)}
                            className={`flex h-6 w-6 items-center justify-center rounded text-[10px] transition-colors ${
                              skill.active ? "bg-accent/20 text-accent" : "bg-surface-hover text-muted"
                            }`}
                            title={skill.active ? "Disable" : "Enable"}
                          >
                            {skill.active ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                            )}
                          </button>
                          <button
                            onClick={() => setEditingSkill({ ...skill })}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                            title="Edit"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                          </button>
                          <button
                            onClick={() => deleteSkill(skill.id)}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                            title="Delete"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-border px-3 py-2">
              <p className="text-[11px] text-muted">
                {activeSkillCount} of {skills.length} skill{skills.length !== 1 ? "s" : ""} active
              </p>
            </div>
          </div>
        )}
        </div>{/* end main content flex */}
      </div>

      {/* ── New Project Modal ── */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowNewProject(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">New Project</h3>
            <p className="mt-1 text-[13px] text-muted">Projects are workspaces where you and Drew collaborate on specific initiatives.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[13px] font-medium text-foreground">Project name</label>
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") createProject(); }}
                    placeholder="e.g. Q1 Product Launch"
                    className="flex-1 bg-transparent text-[15px] text-foreground placeholder-muted outline-none"
                    autoFocus
                  />
                </div>
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Description <span className="text-muted">(optional)</span></label>
                <input
                  type="text"
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="What is this project about?"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground placeholder-muted outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowNewProject(false)} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={createProject}
                disabled={!newProjectName.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Add Task Modal ── */}
      {showAddTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddTask(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">Add Task</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[13px] font-medium text-foreground">Title</label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
                  placeholder="What needs to be done?"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground placeholder-muted outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Description <span className="text-muted">(optional)</span></label>
                <textarea
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  placeholder="Additional details..."
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder-muted outline-none resize-none"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[13px] font-medium text-foreground">Status</label>
                  <select
                    value={newTaskStatus}
                    onChange={(e) => setNewTaskStatus(e.target.value as ProjectTask["status"])}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none"
                  >
                    {BOARD_COLUMNS.map((col) => (
                      <option key={col.key} value={col.key}>{col.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[13px] font-medium text-foreground">Priority</label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as ProjectTask["priority"])}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowAddTask(false)} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={addTask}
                disabled={!newTaskTitle.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30"
              >
                Add Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Skill Modal ── */}
      {showAddSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddSkill(false)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">Add Skill</h3>
            <p className="mt-1 text-[13px] text-muted">Skills give Drew project-specific context and instructions.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[13px] font-medium text-foreground">Skill name</label>
                <input
                  type="text"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  placeholder="e.g. Brand Guidelines, API Spec, Code Style"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground placeholder-muted outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Content</label>
                <textarea
                  value={newSkillContent}
                  onChange={(e) => setNewSkillContent(e.target.value)}
                  placeholder="Paste instructions, guidelines, documentation, or any context Drew should know about..."
                  rows={8}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder-muted outline-none resize-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setShowAddSkill(false); setNewSkillName(""); setNewSkillContent(""); }} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={addSkill}
                disabled={!newSkillName.trim() || !newSkillContent.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30"
              >
                Add Skill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Skill Modal ── */}
      {editingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingSkill(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">Edit Skill</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[13px] font-medium text-foreground">Skill name</label>
                <input
                  type="text"
                  value={editingSkill.name}
                  onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Content</label>
                <textarea
                  value={editingSkill.content}
                  onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                  rows={10}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none resize-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditingSkill(null)} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={saveSkillEdit}
                disabled={!editingSkill.name.trim() || !editingSkill.content.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Event Modal ── */}
      {showAddEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddEvent(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">Add Event</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[13px] font-medium text-foreground">Title</label>
                <input type="text" value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} placeholder="Meeting with..." className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground placeholder-muted outline-none" autoFocus/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-medium text-foreground">Start</label>
                  <input type="datetime-local" value={newEventStart} onChange={(e) => setNewEventStart(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none"/>
                </div>
                <div>
                  <label className="text-[13px] font-medium text-foreground">End</label>
                  <input type="datetime-local" value={newEventEnd} onChange={(e) => setNewEventEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-medium text-foreground">Type</label>
                  <select value={newEventType} onChange={(e) => setNewEventType(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none">
                    <option value="meeting">Meeting</option><option value="call">Call</option><option value="reminder">Reminder</option><option value="deadline">Deadline</option><option value="focus">Focus</option><option value="personal">Personal</option>
                  </select>
                </div>
                <div>
                  <label className="text-[13px] font-medium text-foreground">Calendar</label>
                  <select value={newEventCalType} onChange={(e) => setNewEventCalType(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none">
                    <option value="business">Business</option><option value="personal">Personal</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Contact <span className="text-muted">(optional)</span></label>
                <select value={newEventContactId ?? ""} onChange={(e) => setNewEventContactId(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none">
                  <option value="">No contact</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Location <span className="text-muted">(optional)</span></label>
                <input type="text" value={newEventLocation} onChange={(e) => setNewEventLocation(e.target.value)} placeholder="Zoom, Office, etc." className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder-muted outline-none"/>
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Description <span className="text-muted">(optional)</span></label>
                <textarea value={newEventDesc} onChange={(e) => setNewEventDesc(e.target.value)} placeholder="Additional details..." rows={2} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder-muted outline-none resize-none"/>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowAddEvent(false)} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted hover:text-foreground">Cancel</button>
              <button onClick={createCalendarEvent} disabled={!newEventTitle.trim() || !newEventStart || !newEventEnd} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30">Add Event</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task Edit Modal ── */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingTask(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Edit Task</h3>
              <span className="text-[10px] text-muted">{relativeTime(editingTask.updated_at)}</span>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[13px] font-medium text-foreground">Title</label>
                <input type="text" value={editingTask.title} onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground outline-none focus:border-accent/50" autoFocus/>
              </div>
              <div>
                <label className="text-[13px] font-medium text-foreground">Description</label>
                <textarea value={editingTask.description || ""} onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value || null })} placeholder="Add details..." rows={3} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none resize-none focus:border-accent/50"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-medium text-foreground">Status</label>
                  <select value={editingTask.status} onChange={(e) => setEditingTask({ ...editingTask, status: e.target.value as ProjectTask["status"] })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none">
                    {BOARD_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[13px] font-medium text-foreground">Priority</label>
                  <select value={editingTask.priority} onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as ProjectTask["priority"] })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none">
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-medium text-foreground">Assignee</label>
                  <input type="text" value={editingTask.assignee || ""} onChange={(e) => setEditingTask({ ...editingTask, assignee: e.target.value || null })} placeholder="Unassigned" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder-muted outline-none focus:border-accent/50"/>
                </div>
                <div>
                  <label className="text-[13px] font-medium text-foreground">Due Date</label>
                  <input type="date" value={editingTask.due_date ? editingTask.due_date.split("T")[0] : ""} onChange={(e) => setEditingTask({ ...editingTask, due_date: e.target.value || null })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50"/>
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button onClick={() => { deleteTask(editingTask.id); setEditingTask(null); showToast("Task deleted"); }} className="rounded-lg px-3 py-2 text-[13px] font-medium text-red-400 hover:bg-red-500/10">Delete</button>
              <div className="flex gap-2">
                <button onClick={() => setEditingTask(null)} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted hover:text-foreground">Cancel</button>
                <button onClick={() => { updateTask(editingTask.id, { title: editingTask.title, description: editingTask.description, status: editingTask.status, priority: editingTask.priority, assignee: editingTask.assignee, due_date: editingTask.due_date }); setEditingTask(null); }} disabled={!editingTask.title.trim()} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast Notifications ── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-20 right-6 z-[60] flex flex-col gap-2">
          {toasts.map((toast) => (
            <div key={toast.id} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 shadow-lg animate-in slide-in-from-right ${toast.type === "error" ? "bg-red-500/90 text-white" : "bg-accent/90 text-white"}`}>
              {toast.type === "success" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              )}
              <span className="text-[13px] font-medium">{toast.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Floating Brain Button ── */}
      {viewMode !== "chat" && (
        <button
          onClick={() => setBrainOverlayOpen(true)}
          className={`fixed bottom-20 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all bg-accent text-white hover:opacity-90 brain-pulse md:bottom-6`}
          title="Talk to Drew"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a7 7 0 0 0-7 7c0 3 1.5 5 3 6.5V18h8v-2.5c1.5-1.5 3-3.5 3-6.5a7 7 0 0 0-7-7z"/>
            <path d="M9 22h6"/><path d="M10 18v4"/><path d="M14 18v4"/>
          </svg>
        </button>
      )}

      {/* ── Brain Voice Overlay ── */}
      {brainOverlayOpen && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-background/95 md:inset-auto md:right-6 md:bottom-24 md:w-[360px] md:h-[400px] md:rounded-2xl md:border md:border-border md:bg-surface md:shadow-2xl">
          <button onClick={() => setBrainOverlayOpen(false)} className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-hover-bg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div className="flex flex-col items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                <path d="M12 2a7 7 0 0 0-7 7c0 3 1.5 5 3 6.5V18h8v-2.5c1.5-1.5 3-3.5 3-6.5a7 7 0 0 0-7-7z"/>
                <path d="M9 22h6"/><path d="M10 18v4"/><path d="M14 18v4"/>
              </svg>
            </div>
            <p className="text-[15px] font-medium text-foreground">{recording ? "Listening..." : transcribing ? "Transcribing..." : "Hold to speak to Drew"}</p>
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={() => recording && stopRecording()}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              disabled={sending || transcribing}
              className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-all ${
                recording ? "bg-red-500 text-white scale-110" : transcribing ? "bg-accent/80 text-white" : "bg-accent text-white hover:opacity-90"
              }`}
            >
              {transcribing ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"/>
              ) : recording ? (
                <div className="flex items-center gap-0.5">
                  <span className="h-3 w-1 animate-pulse rounded-full bg-white" style={{ animationDelay: "0ms" }}/>
                  <span className="h-5 w-1 animate-pulse rounded-full bg-white" style={{ animationDelay: "150ms" }}/>
                  <span className="h-4 w-1 animate-pulse rounded-full bg-white" style={{ animationDelay: "300ms" }}/>
                  <span className="h-3 w-1 animate-pulse rounded-full bg-white" style={{ animationDelay: "450ms" }}/>
                </div>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Nav ── */}
      <nav className="mobile-nav items-center justify-around px-2">
        <button onClick={() => navTo("dashboard")} className={`flex flex-col items-center gap-0.5 px-2 py-1 ${viewMode === "dashboard" ? "text-accent" : "text-muted"}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <span className="text-[10px] font-medium">Home</span>
        </button>
        <button onClick={() => { navTo("chat"); }} className={`flex flex-col items-center gap-0.5 px-2 py-1 ${viewMode === "chat" ? "text-accent" : "text-muted"}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span className="text-[10px] font-medium">Chat</span>
        </button>
        <button onClick={() => navTo("board")} className={`flex flex-col items-center gap-0.5 px-2 py-1 ${viewMode === "board" ? "text-accent" : "text-muted"}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          <span className="text-[10px] font-medium">Tasks</span>
        </button>
        <button onClick={() => navTo("contacts")} className={`flex flex-col items-center gap-0.5 px-2 py-1 ${viewMode === "contacts" ? "text-accent" : "text-muted"}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <span className="text-[10px] font-medium">Contacts</span>
        </button>
        <button onClick={() => setMoreSheetOpen(true)} className={`flex flex-col items-center gap-0.5 px-2 py-1 text-muted`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      {/* ── More Sheet (mobile slide-up) ── */}
      {/* ── Password Change Modal ── */}
      {showPasswordChange && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/50" onClick={() => setShowPasswordChange(false)} />
          <div className="fixed left-1/2 top-1/2 z-[81] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-[16px] font-bold text-foreground">Change Password</h3>
            <p className="mt-1 text-[12px] text-muted">Update your account password.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[12px] font-medium text-muted">Current Password</label>
                <input type="password" value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted">New Password</label>
                <input type="password" value={passwordForm.new} onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50" placeholder="Min 8 characters" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted">Confirm New Password</label>
                <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent/50" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setShowPasswordChange(false); setPasswordForm({ current: "", new: "", confirm: "" }); }}
                className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-muted hover:text-foreground">Cancel</button>
              <button onClick={handlePasswordChange} disabled={passwordChanging || !passwordForm.current || !passwordForm.new || !passwordForm.confirm}
                className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-30">
                {passwordChanging ? "Changing..." : "Change Password"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── More Sheet (mobile slide-up) ── */}
      {moreSheetOpen && (
        <>
          <div className="fixed inset-0 z-[55] bg-black/50" onClick={() => setMoreSheetOpen(false)}/>
          <div className="fixed bottom-0 left-0 right-0 z-[56] rounded-t-2xl border-t border-border bg-surface pb-8 sheet-animate" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted/30"/>
            <div className="mt-4 px-4 space-y-1">
              {[
                { mode: "calendar" as ViewMode, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, label: "Calendar" },
                { mode: "files" as ViewMode, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>, label: "Files" },
                { mode: "office" as ViewMode, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>, label: "The Office" },
                { mode: "lab" as ViewMode, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3h6v6l3 9H6l3-9V3z"/><line x1="8" y1="3" x2="16" y2="3"/></svg>, label: "The Lab" },
                { mode: "settings" as ViewMode, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, label: "Settings" },
              ].map((item) => (
                <button key={item.mode} onClick={() => { navTo(item.mode); setMoreSheetOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] transition-colors ${viewMode === item.mode ? "bg-accent/15 text-accent" : "text-foreground hover:bg-hover-bg"}`}>
                  {item.icon}
                  {item.label}
                </button>
              ))}
              {session?.user?.role === "admin" && (
                <button onClick={() => { navTo("admin"); setMoreSheetOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] transition-colors ${viewMode === "admin" ? "bg-accent/15 text-accent" : "text-foreground hover:bg-hover-bg"}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  Admin
                </button>
              )}
              <div className="border-t border-border pt-2 mt-2">
                <a href="https://docs.steadybase.io" target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] text-foreground hover:bg-hover-bg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                  Docs
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto opacity-50"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
                <button onClick={() => { setShowPasswordChange(true); setMoreSheetOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] text-foreground hover:bg-hover-bg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Change Password
                </button>
                <button onClick={() => { signOut(); setMoreSheetOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] text-red-400 hover:bg-hover-bg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
