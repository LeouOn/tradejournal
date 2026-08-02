import { useState } from "react";
import { confirmJournalEntry, type JournalEntry } from "../lib/api";
import JournalComposer from "./JournalComposer";

interface Props {
  accountId: string;
  token: string;
  payload: any;
  onResolved: (entry: JournalEntry) => void;
}

export default function JournalProposalCard({ accountId, token, payload, onResolved }: Props) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await confirmJournalEntry({ accountId, token });
      if (result && typeof result === "object" && result.entry_id) {
        onResolved(result);
      } else {
        setError(result?.error || "Failed to save journal entry.");
      }
    } catch (e) {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <JournalComposer
        accountId={accountId}
        initial={payload}
        onSaved={(entry) => onResolved(entry)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="glass-panel" style={{ padding: 12, display: "grid", gap: 8 }}>
      <strong>Journal entry proposed by AI coach</strong>
      <div style={{ fontWeight: 600 }}>{payload.title}</div>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", maxHeight: 200, overflow: "auto" }}>{payload.body}</pre>
      {payload.context_summary && <div><b>Context:</b> {payload.context_summary}</div>}
      {payload.lesson && <div><b>Lesson:</b> {payload.lesson}</div>}
      {error && <div style={{ color: "var(--accent-red)", fontSize: "0.85rem" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" disabled={busy} onClick={confirm}>Confirm & save</button>
        <button className="btn-secondary" onClick={() => { setError(null); setEditing(true); }}>Edit then save</button>
        <button className="btn-secondary" onClick={() => onResolved(null as any)}>Discard</button>
      </div>
    </div>
  );
}
