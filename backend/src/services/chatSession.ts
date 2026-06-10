import { PrismaClient } from "@prisma/client";

const MAX_TITLE_LENGTH = 30;

/**
 * Derive a session title from the first user message.
 *
 * - Strips newlines and collapses whitespace.
 * - If the cleaned string is empty, returns "New Chat".
 * - If <= 30 chars, returns as-is.
 * - If > 30 chars, truncates at the last word boundary within 30 chars
 *   and appends "...".
 * - If there are no word boundaries (e.g. a run of 'a's), truncates at
 *   exactly 30 chars and appends "...".
 */
export function generateSessionTitle(firstMessage: string): string {
  // Normalise whitespace: replace newlines/tabs with spaces, collapse runs
  const cleaned = firstMessage.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

  if (cleaned.length === 0) {
    return "New Chat";
  }

  if (cleaned.length <= MAX_TITLE_LENGTH) {
    return cleaned;
  }

  // Try to break at a word boundary within MAX_TITLE_LENGTH
  const prefix = cleaned.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = prefix.lastIndexOf(" ");

  if (lastSpace > 0) {
    // Trim trailing space at the boundary
    return prefix.slice(0, lastSpace).trimEnd() + "...";
  }

  // No word boundary found — hard truncate
  return prefix + "...";
}

/**
 * Return the most recently updated session for an account, or null.
 */
export async function getMostRecentSession(
  prisma: PrismaClient,
  accountId: string
) {
  return prisma.chatSession.findFirst({
    where: { account_id: accountId },
    orderBy: { updated_at: "desc" },
  });
}

/**
 * Given an accountId and the first user message, either:
 * - Return the most recent active session if one exists, OR
 * - Create a new session with an auto-generated title.
 *
 * Returns the session object.
 */
export async function getOrCreateSession(
  prisma: PrismaClient,
  accountId: string,
  firstMessage: string
) {
  // Prefer the most recent session
  const existing = await getMostRecentSession(prisma, accountId);
  if (existing) {
    return existing;
  }

  // Auto-create
  const title = generateSessionTitle(firstMessage);
  return prisma.chatSession.create({
    data: {
      title,
      account_id: accountId,
    },
  });
}
