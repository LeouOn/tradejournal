import type { PrismaClient } from "@prisma/client";

type EmbedFn = (text: string) => Promise<number[]>;

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function parseVector(raw: string | null): number[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function embedJournalEntryBody(prisma: PrismaClient, embeddings: { embed: EmbedFn }, entryId: string, body: string) {
  const vector = await embeddings.embed(body);
  await prisma.journalEntry.update({
    where: { entry_id: entryId },
    data: { body_vector: JSON.stringify(vector) },
  });
}

export async function searchJournalEntries(
  prisma: PrismaClient,
  embeddings: { embed: EmbedFn },
  accountId: string,
  query: string,
  topK = 5,
) {
  const queryVec = await embeddings.embed(query);
  const all = await prisma.journalEntry.findMany({
    where: { account_id: accountId, body_vector: { not: null } },
    take: 200,
    orderBy: { entry_date: "desc" },
  });
  const scored = all
    .map((e: any) => ({ e, score: cosine(queryVec, parseVector(e.body_vector)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored.map((s) => s.e);
}

export async function getRecentStandaloneReflections(prisma: PrismaClient, accountId: string, limit = 5) {
  return prisma.journalEntry.findMany({
    where: { account_id: accountId, trade_id: null },
    take: limit,
    orderBy: { entry_date: "desc" },
    include: { entry_tags: { include: { tag: true } } },
  });
}
