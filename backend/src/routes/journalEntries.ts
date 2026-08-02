import { Router } from "express";
import {
  createJournalEntry,
  listJournalEntries,
  getJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
} from "../services/journalEntry";
import { embedJournalEntryBody } from "../services/journalEmbedding";

export async function listJournalEntriesHandler(req: any, res: any) {
  const { accountId, tradeId, symbol, source, tag, from, to } = req.query;
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  const entries = await listJournalEntries(req.prisma, String(accountId), {
    tradeId: tradeId as string | undefined,
    symbol: symbol as string | undefined,
    source: source as string | undefined,
    tag: tag as string | undefined,
    from: from ? new Date(String(from)) : undefined,
    to: to ? new Date(String(to)) : undefined,
  });
  res.json(entries);
}

export async function createJournalEntryHandler(req: any, res: any) {
  const { accountId, ...payload } = req.body;
  if (!accountId || !payload.title || !payload.body) return res.status(400).json({ error: "accountId, title, and body required" });
  const entry = await createJournalEntry(req.prisma, accountId, { ...payload, source: payload.source ?? "MANUAL_FORM" });

  // Best-effort embedding; failure does not block persistence
  try {
    await embedJournalEntryBody(req.prisma, req.embedder, entry.entry_id, entry.body);
  } catch (e) {
    console.warn("journal embedding failed:", e);
  }

  res.json(entry);
}

export async function getJournalEntryHandler(req: any, res: any) {
  const entry = await getJournalEntry(req.prisma, req.params.entryId);
  if (!entry) return res.status(404).json({ error: "not found" });
  res.json(entry);
}

export async function updateJournalEntryHandler(req: any, res: any) {
  const updated = await updateJournalEntry(req.prisma, req.params.entryId, req.body);
  res.json(updated);
}

export async function deleteJournalEntryHandler(req: any, res: any) {
  await deleteJournalEntry(req.prisma, req.params.entryId);
  res.json({ ok: true });
}

export const journalEntriesRouter = Router();
journalEntriesRouter.get("/", listJournalEntriesHandler);
journalEntriesRouter.post("/", createJournalEntryHandler);
journalEntriesRouter.get("/:entryId", getJournalEntryHandler);
journalEntriesRouter.patch("/:entryId", updateJournalEntryHandler);
journalEntriesRouter.delete("/:entryId", deleteJournalEntryHandler);
