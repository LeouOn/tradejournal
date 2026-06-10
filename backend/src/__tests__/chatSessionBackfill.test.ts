import { backfillChatSessions, BackfillSummary } from "../services/chatSessionBackfill";

// We mock PrismaClient's shape with jest.fn() for full control.
// The backfill function takes any PrismaClient-like object, so we
// construct a minimal mock matching the calls it makes.
function createMockPrisma() {
  return {
    chatMessage: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    chatSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  } as any;
}

describe("backfillChatSessions", () => {
  test("Empty DB returns { sessionsCreated: 0, messagesAssigned: 0 }", async () => {
    const prisma = createMockPrisma();
    prisma.chatMessage.findMany.mockResolvedValue([]);

    const result = await backfillChatSessions(prisma);

    expect(result).toEqual({ sessionsCreated: 0, messagesAssigned: 0 });
    expect(prisma.chatMessage.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.chatSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.chatSession.create).not.toHaveBeenCalled();
  });

  test("Account with 5 messages and no session creates 1 session, assigns 5 messages", async () => {
    const prisma = createMockPrisma();
    const fakeSessionId = "session-legacy-1";

    // findMany returns distinct account_ids
    prisma.chatMessage.findMany.mockResolvedValue([{ account_id: "acc-1" }]);
    // No existing legacy session
    prisma.chatSession.findFirst.mockResolvedValue(null);
    // Create returns the new session
    prisma.chatSession.create.mockResolvedValue({ session_id: fakeSessionId });
    // updateMany returns count
    prisma.chatMessage.updateMany.mockResolvedValue({ count: 5 });

    const result = await backfillChatSessions(prisma);

    expect(result).toEqual({ sessionsCreated: 1, messagesAssigned: 5 });
    expect(prisma.chatSession.create).toHaveBeenCalledWith({
      data: {
        title: "Legacy Chat",
        account_id: "acc-1",
      },
    });
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: {
        account_id: "acc-1",
        session_id: null,
      },
      data: {
        session_id: fakeSessionId,
      },
    });
  });

  test("Account with 0 messages creates no session", async () => {
    const prisma = createMockPrisma();
    prisma.chatMessage.findMany.mockResolvedValue([]);

    const result = await backfillChatSessions(prisma);

    expect(result).toEqual({ sessionsCreated: 0, messagesAssigned: 0 });
  });

  test("Two accounts each with messages creates 2 sessions, assigns all messages", async () => {
    const prisma = createMockPrisma();
    const session1 = "session-1";
    const session2 = "session-2";

    // Two distinct accounts
    prisma.chatMessage.findMany.mockResolvedValue([
      { account_id: "acc-1" },
      { account_id: "acc-2" },
    ]);
    // No existing legacy sessions
    prisma.chatSession.findFirst.mockResolvedValue(null);
    // Create sessions sequentially
    prisma.chatSession.create
      .mockResolvedValueOnce({ session_id: session1 })
      .mockResolvedValueOnce({ session_id: session2 });
    // Assign messages
    prisma.chatMessage.updateMany
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 7 });

    const result = await backfillChatSessions(prisma);

    expect(result).toEqual({ sessionsCreated: 2, messagesAssigned: 10 });
    expect(prisma.chatSession.create).toHaveBeenCalledTimes(2);
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledTimes(2);
  });

  test("Re-running backfill on already-backfilled DB: no duplicates, no re-assignment", async () => {
    const prisma = createMockPrisma();
    const existingSessionId = "session-existing";

    // Account still has messages (but they're already assigned)
    prisma.chatMessage.findMany.mockResolvedValue([{ account_id: "acc-1" }]);
    // Legacy session already exists
    prisma.chatSession.findFirst.mockResolvedValue({
      session_id: existingSessionId,
      title: "Legacy Chat",
      account_id: "acc-1",
    });
    // No unassigned messages left
    prisma.chatMessage.updateMany.mockResolvedValue({ count: 0 });

    const result = await backfillChatSessions(prisma);

    expect(result).toEqual({ sessionsCreated: 0, messagesAssigned: 0 });
    // Should NOT create a new session
    expect(prisma.chatSession.create).not.toHaveBeenCalled();
    // Still calls updateMany (with session_id: null filter) but count is 0
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: {
        account_id: "acc-1",
        session_id: null,
      },
      data: {
        session_id: existingSessionId,
      },
    });
  });
});
