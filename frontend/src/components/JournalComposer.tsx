import { useState } from "react";
import { createJournalEntry, JournalEntry } from "../lib/api";

interface Props {
  accountId: string;
  initial?: Partial<JournalEntry>;
  onSaved?: (entry: JournalEntry) => void;
  onCancel?: () => void;
}

export default function JournalComposer({ accountId, initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [direction, setDirection] = useState(initial?.direction ?? "");
  const [sizeLabel, setSizeLabel] = useState(initial?.size_label ?? "");
  const [durationLabel, setDurationLabel] = useState(initial?.duration_label ?? "");
  const [resultLabel, setResultLabel] = useState(initial?.result_label ?? "");
  const [emotionalState, setEmotionalState] = useState(initial?.emotional_state ?? "");
  const [contextSummary, setContextSummary] = useState(initial?.context_summary ?? "");
  const [lesson, setLesson] = useState(initial?.lesson ?? "");
  const [tags, setTags] = useState((initial as any)?.tags?.join(", ") ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title || !body) return;
    setBusy(true);
    const entry = await createJournalEntry({
      accountId,
      title,
      body,
      symbol: symbol || undefined,
      direction: direction || undefined,
      size_label: sizeLabel || undefined,
      duration_label: durationLabel || undefined,
      result_label: resultLabel || undefined,
      emotional_state: emotionalState || undefined,
      context_summary: contextSummary || undefined,
      lesson: lesson || undefined,
      tags: tags ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : undefined,
    });
    setBusy(false);
    onSaved?.(entry);
  };

  return (
    <div className="glass-panel" style={{ padding: 16, display: "grid", gap: 10 }}>
      <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <textarea className="input-field" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reflect on what happened, why, and what you learned…" rows={8} />
      <details>
        <summary style={{ color: "var(--text-secondary)", cursor: "pointer", padding: "4px 0" }}>Optional trade context</summary>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <input className="input-field" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol (e.g. MNQ)" />
          <input className="input-field" value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="LONG or SHORT" />
          <input className="input-field" value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)} placeholder="Size (e.g. 2 MNQ)" />
          <input className="input-field" value={durationLabel} onChange={(e) => setDurationLabel(e.target.value)} placeholder="Duration (e.g. ~7 hours)" />
          <input className="input-field" value={resultLabel} onChange={(e) => setResultLabel(e.target.value)} placeholder="Result (e.g. +$540)" />
          <input className="input-field" value={emotionalState} onChange={(e) => setEmotionalState(e.target.value)} placeholder="Emotional state" />
          <input className="input-field" value={contextSummary} onChange={(e) => setContextSummary(e.target.value)} placeholder="Context summary" />
          <input className="input-field" value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="Lesson" />
          <input className="input-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma-separated" />
        </div>
      </details>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" disabled={busy || !title || !body} onClick={submit}>Save entry</button>
        {onCancel && <button className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
