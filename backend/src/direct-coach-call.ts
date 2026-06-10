import { streamAICoach } from "./services/aiRouter";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const accountId = "30433f3b-78fb-4f16-ad07-9eaae12258ab";

async function runDirect() {
  console.log("Clearing June 9 trades first...");
  await prisma.trade.deleteMany({
    where: {
      account_id: accountId,
      created_at: {
        gte: new Date("2026-06-09T00:00:00Z"),
        lte: new Date("2026-06-09T23:59:59Z")
      }
    }
  });

  const query = `
thanks I made a few scalps yesterday and today. the market went pretty high after I slept and I slept through the opening where it dumped 800 points. I made a few scalps today and am sitting pretty at 2k win today. Of course I want to make more but I have to be really cautious on today with huge swings, ATR on the 1m chart is 40 points still (dropped timeframe to see more granular motion on a volatile bear day) I didn't capture everything I wanted to but it was OK. Happy with my discipline.

06/09/2026 10:55:53	7744617570	SOLD	2	MNQ.M26	28847.50
06/09/2026 10:55:42	7744581635	SOLD	1	MNQ.M26	28855.25
06/09/2026 10:54:31	7744315292	BOUGHT	1	MNQ.M26	28801.00
06/09/2026 10:52:34	7743834176	BOUGHT	1	MNQ.M26	28821.00
06/09/2026 10:51:27	7743522461	SOLD	1	MNQ.M26	28823.00
06/09/2026 10:50:36	7743279229	BOUGHT	2	MNQ.M26	28780.50
06/09/2026 10:46:38	7742088513	BOUGHT	1	MNQ.M26	28810.50
06/09/2026 10:46:17	7741969556	BOUGHT	1	MNQ.M26	28835.75
06/09/2026 10:45:05	7741668232	SOLD	2	MNQ.M26	28866.75
06/09/2026 10:37:17	7740147363	SOLD	1	MNQ.M26	28829.00
06/09/2026 10:37:11	7740123216	SOLD	1	MNQ.M26	28827.75
06/09/2026 10:35:55	7739883499	BOUGHT	2	MNQ.M26	28773.00
06/09/2026 08:57:11	7709182442	BOUGHT	1	MNQ.M26	28729.50
06/09/2026 08:56:38	7708985385	BOUGHT	1	MNQ.M26	28788.75
06/09/2026 08:56:14	7708863215	SOLD	1	MNQ.M26	28835.25
06/09/2026 08:55:59	7708737040	BOUGHT	1	MNQ.M26	28806.25
06/09/2026 08:54:42	7708419121	SOLD	2	MNQ.M26	28861.75
06/09/2026 08:54:25	7708352873	SOLD	1	MNQ.M26	28871.25
06/09/2026 08:54:25	585-823691	SOLD	1	MNQ.M26	28871.00
06/09/2026 08:53:47	7708200000	BOUGHT	2	MNQ.M26	28906.25
06/09/2026 08:53:29	7708101034	SOLD	2	MNQ.M26	28903.00
06/09/2026 08:52:09	7707743008	SOLD	1	MNQ.M26	28950.75
06/09/2026 08:51:56	7707646336	SOLD	1	MNQ.M26	28943.50
06/09/2026 08:51:56	7707646221	SOLD	1	MNQ.M26	28943.50
06/09/2026 08:51:41	7707530198	BOUGHT	1	MNQ.M26	28903.00
06/09/2026 08:48:23	7706748831	BOUGHT	1	MNQ.M26	28901.50
06/09/2026 08:45:07	7705910910	SOLD	1	MNQ.M26	28916.50
06/09/2026 08:44:34	7705779845	BOUGHT	1	MNQ.M26	28899.50
06/09/2026 08:44:25	7705742846	BOUGHT	1	MNQ.M26	28894.50
06/09/2026 08:42:14	7705103307	SOLD	1	MNQ.M26	28914.25
06/09/2026 08:40:37	7704562250	SOLD	1	MNQ.M26	28918.25
06/09/2026 08:40:28	7704505643	SOLD	1	MNQ.M26	28895.50
06/09/2026 08:39:08	7704017657	BOUGHT	1	MNQ.M26	28855.25
06/09/2026 08:32:10	7701299050	BOUGHT	2	MNQ.M26	28873.00
06/09/2026 08:31:01	7700869308	BOUGHT	2	MNQ.M26	28887.75
06/09/2026 01:05:46	7653984972	BOUGHT	1	MNQ.M26	29580.50
06/09/2026 01:05:46	585-539888	BOUGHT	1	MNQ.M26	29580.75
06/09/2026 01:05:08	7653959639	SOLD	1	MNQ.M26	29596.00
06/09/2026 01:01:48	7653841134	SOLD	1	MNQ.M26	29580.50
06/09/2026 00:57:00	7653703030	BOUGHT	2	MNQ.M26	29586.50
06/09/2026 00:56:15	7653689786	SOLD	2	MNQ.M26	29589.25
06/09/2026 00:54:47	7653665333	BOUGHT	3	MNQ.M26	29594.75
06/09/2026 00:49:29	7653536384	SOLD	1	MNQ.M26	29631.50
06/09/2026 00:40:59	7653368398	SOLD	1	MNQ.M26	29599.00
06/09/2026 00:40:59	585-538994	SOLD	1	MNQ.M26	29598.75
`;

  const customSystemPrompt = `You are a trading coach. Your task is to extract executions and log trades from the user's statement. Identify each distinct flat-to-flat sequence. Log each distinct trade by calling the log_trade tool separately in parallel.
CRITICAL: Do not write any thinking process, explanation, internal reasoning, or <think> tags. Go straight to calling the log_trade tool. Output ONLY the tool calls, no text response.`;

  console.log("Calling streamAICoach directly...");
  await streamAICoach(
    accountId,
    query,
    null, // reconciliationReportJson
    "openyourmind", // modelName
    null, // image
    customSystemPrompt, // customSystemPrompt
    0, // historyLimit
    null, // contextFlags (use defaults)
    (token: string) => {
      process.stdout.write(token);
    },
    (fullText: string) => {
      console.log("\n\nDirect call completed!");
    }
  );

  console.log("Verifying DB count...");
  const count = await prisma.trade.count({
    where: {
      account_id: accountId,
      created_at: {
        gte: new Date("2026-06-09T00:00:00Z"),
        lte: new Date("2026-06-09T23:59:59Z")
      }
    }
  });
  console.log(`June 9 trades count in DB: ${count}`);
}

runDirect()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
