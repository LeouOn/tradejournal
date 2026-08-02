import { Router } from "express";
import { createPreview, consumePreview } from "../services/journalPreview";
import { createJournalEntry } from "../services/journalEntry";
import { embedJournalEntryBody } from "../services/journalEmbedding";

export async function previewJournalEntryHandler(req: any, res: any) {
  const { accountId, payload, sourceMessageIds } = req.body;
  if (!accountId || !payload) return res.status(400).json({ error: "accountId and payload required" });
  const { token, expiresAt } = await createPreview(req.prisma, accountId, payload, sourceMessageIds ?? []);
  res.json({ token, expiresAt, payload });
}

export async function confirmJournalEntryHandler(req: any, res: any) {
  const { accountId, token, edits } = req.body;
  if (!accountId || !token) return res.status(400).json({ error: "accountId and token required" });

  let preview: { payload: any; sourceMessageIds: string[] };
  try {
    preview = await consumePreview(req.prisma, token, accountId);
  } catch (err: any) {
    return res.status(409).json({ error: err.message });
  }

  // Snapshot the source messages into raw_conversation
  const messages = await req.prisma.chatMessage.findMany({
    where: { message_id: { in: preview.sourceMessageIds } },
    orderBy: { created_at: "asc" },
  });
  const rawConversation = JSON.stringify(messages.map((m: any) => ({
    message_id: m.message_id,
    role: m.role,
    content: m.content,
    created_at: m.created_at,
  })));

  const merged = { ...preview.payload, ...(edits ?? {}), raw_conversation: rawConversation, source: "AI_COACH" };
  const entry = await createJournalEntry(req.prisma, accountId, merged);

  // Best-effort embedding; failure does not block persistence
  try {
    await embedJournalEntryBody(req.prisma, req.embedder, entry.entry_id, entry.body);
  } catch (e) {
    console.warn("journal embedding failed:", e);
  }

  res.json(entry);
}

export const journalCoachRouter = Router();
journalCoachRouter.post("/preview", previewJournalEntryHandler);
journalCoachRouter.post("/confirm", confirmJournalEntryHandler);
