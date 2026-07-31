import { createJournalEntry, listJournalEntries, getJournalEntry, updateJournalEntry, deleteJournalEntry } from "../services/journalEntry";

function createMockPrisma() {
  const journalEntry = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const journalEntryTag = { deleteMany: jest.fn(), create: jest.fn() };
  const tag = { findUnique: jest.fn(), create: jest.fn() };
  return { journalEntry, journalEntryTag, tag } as any;
}

const ACCOUNT_ID = "acct-1";
const ENTRY_ID = "entry-1";

describe("createJournalEntry", () => {
  test("creates an entry with required fields and attached tags", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.create.mockResolvedValue({ entry_id: ENTRY_ID, body: "x", tags: [] });
    prisma.tag.findUnique.mockResolvedValue(null);
    prisma.tag.create.mockResolvedValue({ tag_id: "tag-1", tag_name: "Patience" });

    const result = await createJournalEntry(prisma, ACCOUNT_ID, {
      title: "First post-recovery trade",
      body: "Long 2 MNQ, held overnight.",
      tags: ["Patience"],
    });

    expect(result.entry_id).toBe(ENTRY_ID);
    expect(prisma.journalEntry.create).toHaveBeenCalled();
    expect(prisma.journalEntryTag.create).toHaveBeenCalled();
  });
});

describe("listJournalEntries", () => {
  test("filters by accountId and trade_id", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findMany.mockResolvedValue([]);
    await listJournalEntries(prisma, ACCOUNT_ID, { tradeId: "trade-1" });
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ account_id: ACCOUNT_ID, trade_id: "trade-1" }) }),
    );
  });
});

describe("updateJournalEntry", () => {
  test("ignores attempts to patch raw_conversation", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.update.mockResolvedValue({ entry_id: ENTRY_ID });
    await updateJournalEntry(prisma, ENTRY_ID, { raw_conversation: "x" });
    const call = prisma.journalEntry.update.mock.calls[0][0];
    expect(call.data.raw_conversation).toBeUndefined();
  });
});
