import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const accountId = "30433f3b-78fb-4f16-ad07-9eaae12258ab";

async function testUserTrades() {
  console.log("Sending June 3rd trades statement paste to AI Coach...");

  const query = `
testing these trades. it was a frustrating day. the last trade I thought it was absorption but really it was eating up the orders and then it went down 70 points in my favor.

Time	Side	Quantity	Symbol	Price
06/03/2026 12:52:17	BOUGHT	1	MNQ.M26	30670.50
06/03/2026 12:52:17	BOUGHT	2	MNQ.M26	30670.75
06/03/2026 12:50:15	SOLD	1	MNQ.M26	30666.00
06/03/2026 12:40:12	SOLD	1	MNQ.M26	30673.25
06/03/2026 12:26:35	SOLD	1	MNQ.M26	30623.00
06/03/2026 01:22:02	BOUGHT	1	MNQ.M26	30710.50
06/03/2026 01:22:02	BOUGHT	3	MNQ.M26	30710.75
06/03/2026 01:16:38	SOLD	2	MNQ.M26	30730.50
06/02/2026 23:10:19	SOLD	1	MNQ.M26	30691.25
06/02/2026 22:34:54	SOLD	1	MNQ.M26	30694.75
`;

  // First check if there are existing trades for these dates and clear them to start clean
  await prisma.trade.deleteMany({
    where: {
      account_id: accountId,
      created_at: {
        gte: new Date("2026-06-02T22:00:00Z"),
        lte: new Date("2026-06-03T23:59:59Z")
      }
    }
  });

  const response = await fetch("http://localhost:5000/api/ai/coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      accountId,
      query,
      model: null,
      image: null,
      systemPrompt: null,
      historyLimit: 5
    })
  });

  if (!response.ok) {
    throw new Error(`Server returned status ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let done = false;
  let fullText = "";

  while (!done) {
    const { value, done: doneReading } = await reader.read();
    done = doneReading;
    if (value) {
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.token) {
              process.stdout.write(data.token);
              fullText += data.token;
            }
          } catch (e) {
            // ignore partial/invalid json
          }
        }
      }
    }
  }

  console.log("\n\nVerifying DB records after ingestion...");
  const trades = await prisma.trade.findMany({
    where: {
      account_id: accountId,
      created_at: {
        gte: new Date("2026-06-02T00:00:00Z"),
        lte: new Date("2026-06-03T23:59:59Z")
      }
    },
    include: {
      executions: true
    }
  });

  console.log(`Found ${trades.length} trades in DB for June 2nd/3rd:`);
  for (const t of trades) {
    console.log(`- Trade ${t.trade_id.substring(0, 8)}: Symbol=${t.symbol}, Status=${t.status}, Net P&L=$${t.net_pnl}, Rules=${t.rules_followed}`);
    for (const e of t.executions) {
      console.log(`    * Exec: ${e.side} ${e.quantity} @ ${e.fill_price} at ${e.execution_timestamp}`);
    }
  }
}

testUserTrades()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
