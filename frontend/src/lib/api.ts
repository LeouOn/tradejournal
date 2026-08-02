const API_BASE = "http://localhost:5000";

export interface JournalEntry {
  entry_id: string;
  account_id: string;
  trade_id: string | null;
  title: string;
  body: string;
  entry_date: string;
  symbol: string | null;
  direction: string | null;
  size_label: string | null;
  duration_label: string | null;
  result_label: string | null;
  emotional_state: string | null;
  context_summary: string | null;
  lesson: string | null;
  raw_conversation: string;
  body_vector: string | null;
  source: string;
  created_at: string;
  entry_tags?: { tag: { tag_id: string; tag_name: string } }[];
  trade?: { trade_id: string; symbol: string; net_pnl: string } | null;
}

export const listJournalEntries = (params: Record<string, string | number | undefined>) =>
  fetch(`${API_BASE}/api/journal-entries?${new URLSearchParams(params as any)}`).then((r) => r.json());

export const createJournalEntry = (payload: Partial<JournalEntry> & { accountId: string }) =>
  fetch(`${API_BASE}/api/journal-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

export const getJournalEntry = (entryId: string) =>
  fetch(`${API_BASE}/api/journal-entries/${entryId}`).then((r) => r.json());

export const updateJournalEntry = (entryId: string, patch: Partial<JournalEntry>) =>
  fetch(`${API_BASE}/api/journal-entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => r.json());

export const deleteJournalEntry = (entryId: string) =>
  fetch(`${API_BASE}/api/journal-entries/${entryId}`, { method: "DELETE" }).then((r) => r.json());

export const previewJournalEntry = (payload: { accountId: string; payload: any; sourceMessageIds?: string[] }) =>
  fetch(`${API_BASE}/api/coach/journal/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

export const confirmJournalEntry = (payload: { accountId: string; token: string; edits?: any }) =>
  fetch(`${API_BASE}/api/coach/journal/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
