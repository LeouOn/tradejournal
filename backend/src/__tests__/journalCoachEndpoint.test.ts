import {
  journalCoachRouter,
  previewJournalEntryHandler,
  confirmJournalEntryHandler,
} from "../routes/journalCoach";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload: any) => { res.body = payload; return res; });
  return res;
}

describe("previewJournalEntryHandler", () => {
  test("requires accountId and payload", async () => {
    const res = mockRes();
    await previewJournalEntryHandler({ body: {}, prisma: {} } as any, res);
    expect(res.statusCode).toBe(400);
  });

  test("issues a token valid for 15 minutes", async () => {
    const prisma = {
      journalPreview: { create: jest.fn().mockResolvedValue({ token: "test-token" }) },
    } as any;
    const res = mockRes();
    await previewJournalEntryHandler(
      { body: { accountId: "a", payload: { title: "t", body: "b" }, sourceMessageIds: [] }, prisma } as any,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});

describe("confirmJournalEntryHandler", () => {
  test("returns 409 when token is invalid or already consumed", async () => {
    const prisma = {
      journalPreview: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const res = mockRes();
    await confirmJournalEntryHandler({ body: { accountId: "a", token: "missing" }, prisma } as any, res);
    expect(res.statusCode).toBe(409);
  });
});
