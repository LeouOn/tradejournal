import { embedJournalEntryBody, searchJournalEntries, getRecentStandaloneReflections } from "../services/journalEmbedding";

function createMockPrisma() {
  return {
    journalEntry: {
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  } as any;
}

function createMockEmbeddings(responses: number[][]) {
  let i = 0;
  return {
    embed: jest.fn(async () => responses[i++] ?? []),
  } as any;
}

describe("embedJournalEntryBody", () => {
  test("stores JSON-stringified floats into body_vector (matches notes_vector format)", async () => {
    const prisma = createMockPrisma();
    const embeddings = createMockEmbeddings([[0.1, 0.2, 0.3]]);
    await embedJournalEntryBody(prisma, embeddings, "entry-1", "hello world");
    const updateCall = prisma.journalEntry.update.mock.calls[0][0];
    expect(updateCall.data.body_vector).toBe(JSON.stringify([0.1, 0.2, 0.3]));
  });
});

describe("searchJournalEntries", () => {
  test("returns top-K entries sorted by cosine similarity, parsing JSON vectors", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findMany.mockResolvedValue([
      { entry_id: "a", body_vector: JSON.stringify([1, 0, 0]) },
      { entry_id: "b", body_vector: JSON.stringify([0, 1, 0]) },
    ]);
    const embeddings = createMockEmbeddings([[1, 0, 0]]);
    const result = await searchJournalEntries(prisma, embeddings, "acct-1", "query", 2);
    expect(result[0].entry_id).toBe("a");
  });
});

describe("getRecentStandaloneReflections", () => {
  test("queries by accountId, ordered by entry_date desc, no Trade FK", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findMany.mockResolvedValue([]);
    await getRecentStandaloneReflections(prisma, "acct-1", 5);
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ account_id: "acct-1", trade_id: null }),
        take: 5,
      }),
    );
  });
});
