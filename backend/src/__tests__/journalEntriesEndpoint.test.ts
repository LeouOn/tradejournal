import {
  journalEntriesRouter,
  listJournalEntriesHandler,
  createJournalEntryHandler,
  getJournalEntryHandler,
  updateJournalEntryHandler,
  deleteJournalEntryHandler,
} from "../routes/journalEntries";

// Reuse the mock-prisma pattern from journalEntry.test.ts (Task 2):
// the create/update services wrap writes in prisma.$transaction, so the mock
// must implement $transaction by invoking the callback with itself, and must
// expose findUniqueOrThrow (post-write re-fetch) + tag.upsert (ensureTag).
function createMockPrisma() {
  const journalEntry = {
    create: jest.fn().mockResolvedValue({ entry_id: "e1" }),
    findMany: jest.fn().mockResolvedValue([{ entry_id: "e1" }]),
    findUnique: jest.fn().mockResolvedValue({ entry_id: "e1" }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ entry_id: "e1" }),
    update: jest.fn().mockResolvedValue({ entry_id: "e1" }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const tag = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    upsert: jest.fn().mockResolvedValue({ tag_id: "t1", tag_name: "x" }),
  };
  const journalEntryTag = { deleteMany: jest.fn(), create: jest.fn() };
  const prisma: any = { journalEntry, tag, journalEntryTag };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return prisma as any;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload: any) => { res.body = payload; return res; });
  return res;
}

describe("listJournalEntriesHandler", () => {
  test("requires accountId", async () => {
    const res = mockRes();
    await listJournalEntriesHandler({ query: {} } as any, res);
    expect(res.statusCode).toBe(400);
  });

  test("lists entries for the account", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await listJournalEntriesHandler({ query: { accountId: "acc-1" }, prisma } as any, res);
    expect(res.statusCode).toBe(200);
    expect(prisma.journalEntry.findMany).toHaveBeenCalled();
  });
});

describe("createJournalEntryHandler", () => {
  test("requires title and body", async () => {
    const res = mockRes();
    await createJournalEntryHandler({ body: { accountId: "acc-1" }, prisma: createMockPrisma() } as any, res);
    expect(res.statusCode).toBe(400);
  });

  test("creates entry with valid payload", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await createJournalEntryHandler({ body: { accountId: "acc-1", title: "t", body: "b" }, prisma } as any, res);
    expect(res.statusCode).toBe(200);
    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });
});

describe("getJournalEntryHandler", () => {
  test("returns 404 when entry missing", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await getJournalEntryHandler({ params: { entryId: "missing" }, prisma } as any, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("updateJournalEntryHandler", () => {
  test("delegates to updateJournalEntry", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await updateJournalEntryHandler({ params: { entryId: "e1" }, body: { title: "new" }, prisma } as any, res);
    expect(prisma.journalEntry.update).toHaveBeenCalled();
  });
});

describe("deleteJournalEntryHandler", () => {
  test("calls delete", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await deleteJournalEntryHandler({ params: { entryId: "e1" }, prisma } as any, res);
    expect(prisma.journalEntry.delete).toHaveBeenCalled();
  });
});
