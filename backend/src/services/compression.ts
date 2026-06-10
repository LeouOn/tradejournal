import { PrismaClient } from "@prisma/client";
import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const baseURL = process.env.OPENAI_BASE_URL || "http://localhost:1234/v1";
const apiKey = process.env.OPENAI_API_KEY || "lm-studio";

const openai = new OpenAI({
  baseURL,
  apiKey,
  dangerouslyAllowBrowser: false,
});

export async function compressChatHistory(accountId: string) {
  const unarchivedMessages = await prisma.chatMessage.findMany({
    where: {
      account_id: accountId,
      is_archived: false,
      is_summary: false,
    },
    orderBy: { created_at: "asc" },
  });

  if (unarchivedMessages.length === 0) {
    return { status: "no_messages", message: "No unarchived messages to compress." };
  }

  let transcript = "";
  for (const msg of unarchivedMessages) {
    let contentText = msg.content;
    if (contentText.length > 500 && (contentText.includes("MNQ") || contentText.includes("BOUGHT") || contentText.includes("SOLD"))) {
      contentText = "[Large execution statement omitted for summarization]";
    }
    transcript += `[${msg.created_at.toISOString()}] ${msg.role.toUpperCase()}: ${contentText}\n\n`;
  }

  const systemPrompt = `You are an expert trading psychology coach summarizing a past conversation.
Your goal is to compress the provided conversation transcript into a dense, highly informative "Memory Block" that captures:
1. The trades the user took (symbols, PnL, setups).
2. The user's psychological state and any behavioral mistakes (e.g., FOMO, revenge trading, over-leveraging).
3. Any specific lessons or rules the user committed to.

Be concise. Use bullet points. Do not include pleasantries. This summary will be injected into your future system prompt to provide long-term memory of this user.`;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || "openyourmind-qwen3.6-35b-a3b-kuato-dpo-abliterated-uncensored-i1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here is the conversation transcript to summarize:\n\n${transcript}` }
      ],
      max_tokens: 1500,
      temperature: 0.2,
    });

    const summaryText = response.choices[0]?.message?.content?.trim();

    if (!summaryText) {
      throw new Error("LLM returned an empty summary.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.create({
        data: {
          account_id: accountId,
          role: "assistant",
          content: `[COMPRESSED HISTORY SUMMARY]\n${summaryText}`,
          is_summary: true,
          is_archived: false,
        }
      });

      const messageIds = unarchivedMessages.map(m => m.message_id);
      await tx.chatMessage.updateMany({
        where: { message_id: { in: messageIds } },
        data: { is_archived: true }
      });
    });

    return { status: "success", message: `Compressed ${unarchivedMessages.length} messages into 1 summary block.` };
  } catch (error: any) {
    console.error("Error during compression:", error);
    throw new Error(`Failed to compress history: ${error.message}`);
  }
}
