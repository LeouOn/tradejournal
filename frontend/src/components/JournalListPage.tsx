import { useEffect, useState } from "react";
import { listJournalEntries, type JournalEntry } from "../lib/api";
import JournalComposer from "./JournalComposer";
import JournalEntryView from "./JournalEntryView";

export default function JournalListPage({ accountId }: { accountId: string }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<JournalEntry | null>(null);

  const reload = async () => setEntries(await listJournalEntries({ accountId }));
  useEffect(() => { reload(); }, [accountId]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Journal</h2>
        <button className="btn-primary" onClick={() => setComposing(true)}>New entry</button>
      </header>
      {composing && (
        <JournalComposer accountId={accountId} onSaved={() => { setComposing(false); reload(); }} onCancel={() => setComposing(false)} />
      )}
      <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0 }}>
        {entries.map((e) => (
          <li key={e.entry_id} className="glass-panel" style={{ padding: 12, cursor: "pointer" }} onClick={() => setViewing(e)}>
            <strong>{e.title}</strong>
            <div style={{ opacity: 0.7, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {new Date(e.entry_date).toLocaleDateString()} · {e.symbol ?? "—"} · {e.source}
            </div>
          </li>
        ))}
      </ul>
      {viewing && (
        <div role="dialog" style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", display: "grid", placeItems: "center", zIndex: 1000 }} onClick={() => setViewing(null)}>
          <div className="glass-panel" style={{ padding: 20, maxWidth: 720, width: "100%", maxHeight: "85vh", overflowY: "auto" }} onClick={(ev) => ev.stopPropagation()}>
            <JournalEntryView entry={viewing} onClose={() => setViewing(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
