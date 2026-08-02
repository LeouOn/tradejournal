import { JournalEntry } from "../lib/api";

export default function JournalEntryView({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>{entry.title}</h3>
        <button className="btn-secondary" onClick={onClose}>Close</button>
      </header>
      <div style={{ fontSize: "0.85rem", opacity: 0.7, color: "var(--text-secondary)" }}>
        {new Date(entry.entry_date).toLocaleString()} · {entry.symbol ?? "—"} · {entry.source}
      </div>
      {entry.trade_id && <div>Linked to trade: {entry.trade_id.slice(0, 8)}…</div>}
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{entry.body}</pre>
      {(entry.context_summary || entry.lesson || entry.emotional_state) && (
        <section>
          <strong>Structured fields</strong>
          <ul>
            {entry.context_summary && <li><b>Context:</b> {entry.context_summary}</li>}
            {entry.emotional_state && <li><b>Emotional state:</b> {entry.emotional_state}</li>}
            {entry.result_label && <li><b>Result:</b> {entry.result_label}</li>}
            {entry.lesson && <li><b>Lesson:</b> {entry.lesson}</li>}
          </ul>
        </section>
      )}
      <details>
        <summary style={{ color: "var(--text-secondary)", cursor: "pointer", padding: "4px 0" }}>Raw conversation (immutable snapshot)</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
{entry.raw_conversation}
        </pre>
      </details>
    </div>
  );
}
