import { PrismaClient } from "@prisma/client";

export interface BackfillSummary {
  sessionsCreated: number;
  messagesAssigned: number;
}

/**
 * Idempotent backfill: creates one "Legacy Chat" session per account that has
 * chat messages, then assigns all unassigned (session_id IS NULL) messages to
 * that session. Safe to re-run — existing legacy sessions are reused and
 * already-assigned messages are left untouched.
 */
export async function backfillChatSessions(
  prisma: PrismaClient
): Promise<BackfillSummary> {
  // 1. Find distinct account_ids that have at least one ChatMessage.
  const accounts = await prisma.chatMessage.findMany({
    distinct: ["account_id"],
    select: { account_id: true },
  });

  if (accounts.length === 0) {
    return { sessionsCreated: 0, messagesAssigned: 0 };
  }

  let sessionsCreated = 0;
  let messagesAssigned = 0;

  for (const { account_id } of accounts) {
    // 2. Find or create a "Legacy Chat" session for this account.
    let session = await prisma.chatSession.findFirst({
      where: {
        account_id,
        title: "Legacy Chat",
      },
    });

    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          title: "Legacy Chat",
          account_id,
        },
      });
      sessionsCreated += 1;
    }

    // 3. Assign all unassigned messages for this account.
    const result = await prisma.chatMessage.updateMany({
      where: {
        account_id,
        session_id: null,
      },
      data: {
        session_id: session.session_id,
      },
    });

    messagesAssigned += result.count;
  }

  return { sessionsCreated, messagesAssigned };
}
