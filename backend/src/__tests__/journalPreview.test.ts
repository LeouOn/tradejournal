import { createPreview, consumePreview, pruneExpiredPreviews } from "../services/journalPreview";

function createMockPrisma() {
  const journalPreview = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  };
  return { journalPreview } as any;
}

const ACCOUNT_ID = "acct-1";
const TOKEN = "tok-abc";

describe("createPreview", () => {
  test("returns a token with expiry 15 minutes in the future", async () => {
    const prisma = createMockPrisma();
    prisma.journalPreview.create.mockResolvedValue({ token: TOKEN, expires_at: new Date(Date.now() + 1000) });
    const result = await createPreview(prisma, ACCOUNT_ID, { title: "t", body: "b" }, ["m1"]);
    expect(result.token).toBe(TOKEN);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });
});

describe("consumePreview", () => {
  test("marks preview consumed and returns payload", async () => {
    const prisma = createMockPrisma();
    prisma.journalPreview.findUnique.mockResolvedValue({
      token: TOKEN,
      account_id: ACCOUNT_ID,
      proposed_payload: '{"title":"t","body":"b"}',
      source_message_ids: '["m1"]',
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
    });
    const result = await consumePreview(prisma, TOKEN, ACCOUNT_ID);
    expect(result.payload.title).toBe("t");
    expect(prisma.journalPreview.update).toHaveBeenCalled();
  });

  test("throws on expired preview", async () => {
    const prisma = createMockPrisma();
    prisma.journalPreview.findUnique.mockResolvedValue({
      token: TOKEN,
      account_id: ACCOUNT_ID,
      proposed_payload: "{}",
      source_message_ids: "[]",
      expires_at: new Date(Date.now() - 1000),
      consumed_at: null,
    });
    await expect(consumePreview(prisma, TOKEN, ACCOUNT_ID)).rejects.toThrow(/expired/i);
  });
});
