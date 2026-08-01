import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export async function createPreview(prisma: PrismaClient, accountId: string, payload: unknown, sourceMessageIds: string[]) {
  const expiresAt = new Date(Date.now() + FIFTEEN_MINUTES_MS);
  const token = randomUUID();
  const created = await prisma.journalPreview.create({
    data: {
      token,
      account_id: accountId,
      proposed_payload: JSON.stringify(payload),
      source_message_ids: JSON.stringify(sourceMessageIds),
      expires_at: expiresAt,
    },
  });
  return { token: created.token, expiresAt };
}

export async function consumePreview(prisma: PrismaClient, token: string, accountId: string) {
  const record = await prisma.journalPreview.findUnique({ where: { token } });
  if (!record || record.account_id !== accountId) throw new Error("Preview not found");
  if (record.consumed_at) throw new Error("Preview already consumed");
  if (record.expires_at.getTime() < Date.now()) throw new Error("Preview expired");

  await prisma.journalPreview.update({
    where: { token },
    data: { consumed_at: new Date() },
  });

  return {
    payload: JSON.parse(record.proposed_payload),
    sourceMessageIds: JSON.parse(record.source_message_ids),
  };
}

export async function pruneExpiredPreviews(prisma: PrismaClient) {
  const result = await prisma.journalPreview.deleteMany({
    where: { expires_at: { lt: new Date() } },
  });
  return result.count;
}
