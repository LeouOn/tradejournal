import type { PrismaClient, Prisma } from "@prisma/client";

export interface CreateJournalEntryInput {
  title: string;
  body: string;
  trade_id?: string;
  entry_date?: Date;
  symbol?: string;
  direction?: string;
  size_label?: string;
  duration_label?: string;
  result_label?: string;
  emotional_state?: string;
  context_summary?: string;
  lesson?: string;
  raw_conversation?: string;
  body_vector?: string | null;
  source?: string;
  tags?: string[];
}

export interface JournalEntryFilters {
  tradeId?: string;
  symbol?: string;
  source?: string;
  from?: Date;
  to?: Date;
  tag?: string;
}

type JournalEntryWithRelations = Prisma.JournalEntryGetPayload<{
  include: { entry_tags: { include: { tag: true } } };
}>;

type UpdateJournalEntryFields = Omit<CreateJournalEntryInput, "raw_conversation">;

async function ensureTag(prisma: Prisma.TransactionClient, name: string) {
  return prisma.tag.upsert({
    where: { tag_name: name },
    update: {},
    create: { tag_category: "AI_GENERATED", tag_name: name, color_code: "#4A90E2" },
  });
}

export async function createJournalEntry(
  prisma: PrismaClient,
  accountId: string,
  input: CreateJournalEntryInput,
): Promise<JournalEntryWithRelations> {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        account_id: accountId,
        trade_id: input.trade_id,
        title: input.title,
        body: input.body,
        entry_date: input.entry_date ?? new Date(),
        symbol: input.symbol,
        direction: input.direction,
        size_label: input.size_label,
        duration_label: input.duration_label,
        result_label: input.result_label,
        emotional_state: input.emotional_state,
        context_summary: input.context_summary,
        lesson: input.lesson,
        raw_conversation: input.raw_conversation ?? "[]",
        body_vector: input.body_vector ?? null,
        source: input.source ?? "MANUAL_FORM",
      },
    });

    if (input.tags?.length) {
      for (const name of input.tags) {
        const tag = await ensureTag(tx, name);
        await tx.journalEntryTag.create({ data: { entry_id: entry.entry_id, tag_id: tag.tag_id } });
      }
    }

    return tx.journalEntry.findUniqueOrThrow({
      where: { entry_id: entry.entry_id },
      include: { entry_tags: { include: { tag: true } } },
    });
  });
}

export async function listJournalEntries(prisma: PrismaClient, accountId: string, filters: JournalEntryFilters = {}) {
  return prisma.journalEntry.findMany({
    where: {
      account_id: accountId,
      trade_id: filters.tradeId,
      symbol: filters.symbol,
      source: filters.source,
      entry_date: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
      entry_tags: filters.tag ? { some: { tag: { tag_name: filters.tag } } } : undefined,
    },
    orderBy: { entry_date: "desc" },
    include: { entry_tags: { include: { tag: true } }, trade: true },
  });
}

export async function getJournalEntry(prisma: PrismaClient, entryId: string) {
  return prisma.journalEntry.findUnique({
    where: { entry_id: entryId },
    include: { entry_tags: { include: { tag: true } }, trade: true },
  });
}

export async function updateJournalEntry(
  prisma: PrismaClient,
  entryId: string,
  patch: Partial<CreateJournalEntryInput>,
): Promise<JournalEntryWithRelations> {
  // raw_conversation is immutable; tags are handled separately below.
  const { raw_conversation: _ignored, tags, ...data } = patch;

  return prisma.$transaction(async (tx) => {
    await tx.journalEntry.update({
      where: { entry_id: entryId },
      data,
    });

    if (tags) {
      await tx.journalEntryTag.deleteMany({ where: { entry_id: entryId } });
      for (const name of tags) {
        const tag = await ensureTag(tx, name);
        await tx.journalEntryTag.create({ data: { entry_id: entryId, tag_id: tag.tag_id } });
      }
    }

    return tx.journalEntry.findUniqueOrThrow({
      where: { entry_id: entryId },
      include: { entry_tags: { include: { tag: true } } },
    });
  });
}

export async function deleteJournalEntry(prisma: PrismaClient, entryId: string) {
  await prisma.journalEntry.delete({ where: { entry_id: entryId } });
}
