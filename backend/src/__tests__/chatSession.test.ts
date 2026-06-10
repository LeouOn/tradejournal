import { generateSessionTitle } from "../services/chatSession";

// Mock PrismaClient shape following the same pattern as chatSessionBackfill.test.ts
function createMockPrisma() {
  return {
    chatSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  } as any;
}

describe("generateSessionTitle", () => {
  test("long message is truncated to ~30 chars at word boundary with ellipsis", () => {
    const result = generateSessionTitle(
      "hello world this is a test of session title generation"
    );
    expect(result.length).toBeLessThanOrEqual(33); // 30 chars + "..."
    expect(result.endsWith("...")).toBe(true);
    // "of" is a complete word — we did NOT break mid-word
    // e.g. we should NOT get "hello world this is a test o..."
    expect(result).not.toBe("hello world this is a test o...");
    // Should start with the beginning of the message
    expect(result.startsWith("hello")).toBe(true);
  });

  test("empty string returns 'New Chat'", () => {
    expect(generateSessionTitle("")).toBe("New Chat");
  });

  test("whitespace-only string returns 'New Chat'", () => {
    expect(generateSessionTitle("   ")).toBe("New Chat");
  });

  test("short message is returned as-is without truncation", () => {
    expect(generateSessionTitle("short message")).toBe("short message");
  });

  test("multi-line message is flattened to single line", () => {
    const result = generateSessionTitle("multi\nline\nmessage");
    expect(result).toBe("multi line message");
  });

  test("excessive whitespace is collapsed", () => {
    const result = generateSessionTitle("too   much    space");
    expect(result).toBe("too much space");
  });

  test("100-char string of 'a' is truncated to ~30 chars + ellipsis", () => {
    const result = generateSessionTitle("a".repeat(100));
    // No word boundaries to break on, so just truncate at 30 chars
    expect(result).toBe("a".repeat(30) + "...");
    expect(result.length).toBe(33);
  });

  test("message exactly 30 chars is returned as-is", () => {
    const msg = "a".repeat(30);
    expect(generateSessionTitle(msg)).toBe(msg);
  });

  test("message at 31 chars is truncated with ellipsis", () => {
    // 31 chars: "hello world this is a test mess" — exceeds 30, should truncate
    const result = generateSessionTitle("hello world this is a test mess");
    expect(result.endsWith("...")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(33);
  });
});

describe("getOrCreateSession", () => {
  test("returns existing active session when one exists", async () => {
    const { getOrCreateSession } = await import("../services/chatSession");
    const prisma = createMockPrisma();
    const existingSession = {
      session_id: "sess-existing",
      title: "Existing Chat",
      account_id: "acc-1",
    };

    prisma.chatSession.findFirst.mockResolvedValue(existingSession);

    const result = await getOrCreateSession(prisma, "acc-1", "Hello world");

    expect(result).toBe(existingSession);
    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
      where: { account_id: "acc-1" },
      orderBy: { updated_at: "desc" },
    });
    expect(prisma.chatSession.create).not.toHaveBeenCalled();
  });

  test("creates new session with auto-title when none exists", async () => {
    const { getOrCreateSession } = await import("../services/chatSession");
    const prisma = createMockPrisma();
    const newSession = {
      session_id: "sess-new",
      title: "Hello this is my first...",
      account_id: "acc-1",
    };

    prisma.chatSession.findFirst.mockResolvedValue(null);
    prisma.chatSession.create.mockResolvedValue(newSession);

    const result = await getOrCreateSession(
      prisma,
      "acc-1",
      "Hello this is my first message to the coach"
    );

    expect(result).toBe(newSession);
    expect(prisma.chatSession.create).toHaveBeenCalledWith({
      data: {
        title: expect.any(String),
        account_id: "acc-1",
      },
    });
  });
});

describe("getMostRecentSession", () => {
  test("returns the most recent session for an account", async () => {
    const { getMostRecentSession } = await import("../services/chatSession");
    const prisma = createMockPrisma();
    const recentSession = {
      session_id: "sess-recent",
      title: "Recent Chat",
      account_id: "acc-1",
    };

    prisma.chatSession.findFirst.mockResolvedValue(recentSession);

    const result = await getMostRecentSession(prisma, "acc-1");

    expect(result).toBe(recentSession);
    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
      where: { account_id: "acc-1" },
      orderBy: { updated_at: "desc" },
    });
  });

  test("returns null when no sessions exist", async () => {
    const { getMostRecentSession } = await import("../services/chatSession");
    const prisma = createMockPrisma();

    prisma.chatSession.findFirst.mockResolvedValue(null);

    const result = await getMostRecentSession(prisma, "acc-1");

    expect(result).toBeNull();
  });
});
