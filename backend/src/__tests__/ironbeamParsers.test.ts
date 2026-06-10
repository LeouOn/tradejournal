import {
  parsePrimaryRegex,
  parseDailyStatement,
  parseSimpleSplit,
  parseOrderIdFormat,
  normalizeSymbol,
  ParsedExecution,
} from "../utils/ironbeamParsers";

// Tab-separated helper — builds a line with tabs between fields
function tabLine(...fields: string[]): string {
  return fields.join("\t");
}

// Real user data from the bug report (22 executions, all MNQ.M26)
const USER_DATA = `Date\tTime\tOrder ID\tSide\tQty\tSymbol\tPrice
06/10/2026\t12:50:13\tORD_052\tSOLD\t1\tMNQ.M26\t28627.00
06/10/2026\t12:50:13\tORD_053\tSOLD\t1\tMNQ.M26\t28626.75
06/10/2026\t12:50:10\tORD_054\tSOLD\t2\tMNQ.M26\t28601.50
06/10/2026\t12:49:17\tORD_055\tBOUGHT\t1\tMNQ.M26\t28571.25
06/10/2026\t12:49:17\tORD_056\tBOUGHT\t1\tMNQ.M26\t28571.25
06/10/2026\t12:49:17\tORD_057\tBOUGHT\t1\tMNQ.M26\t28571.25
06/10/2026\t12:49:05\tORD_058\tSOLD\t2\tMNQ.M26\t28567.50
06/10/2026\t12:49:05\tORD_059\tSOLD\t1\tMNQ.M26\t28567.50
06/10/2026\t12:48:46\tORD_060\tSOLD\t1\tMNQ.M26\t28563.00
06/10/2026\t12:48:46\tORD_061\tSOLD\t1\tMNQ.M26\t28563.00
06/10/2026\t12:48:42\tORD_062\tSOLD\t1\tMNQ.M26\t28558.75
06/10/2026\t12:48:42\tORD_063\tSOLD\t1\tMNQ.M26\t28558.75
06/10/2026\t12:48:37\tORD_064\tSOLD\t1\tMNQ.M26\t28554.25
06/10/2026\t12:48:37\tORD_065\tSOLD\t1\tMNQ.M26\t28554.25
06/10/2026\t12:48:33\tORD_066\tSOLD\t1\tMNQ.M26\t28550.50
06/10/2026\t12:48:33\tORD_067\tSOLD\t1\tMNQ.M26\t28550.50
06/10/2026\t12:55:21\tORD_068\tSOLD\t1\tMNQ.M26\t28613.50
06/10/2026\t12:55:21\tORD_069\tSOLD\t1\tMNQ.M26\t28613.50
06/10/2026\t12:55:15\tORD_070\tBOUGHT\t1\tMNQ.M26\t28601.75
06/10/2026\t12:55:15\tORD_071\tBOUGHT\t1\tMNQ.M26\t28601.75
06/10/2026\t12:59:49\tORD_072\tBOUGHT\t1\tMNQ.M26\t28549.50
06/10/2026\t12:56:36\tORD_073\tSOLD\t1\tMNQ.M26\t28590.50`;

// ============================================================
// normalizeSymbol tests
// ============================================================
describe("normalizeSymbol", () => {
  test("strips .M26 contract suffix and normalizes MNQ", () => {
    expect(normalizeSymbol("MNQ.M26")).toBe("MNQ");
  });

  test("normalizes existing symbols", () => {
    expect(normalizeSymbol("ES")).toBe("ES");
    expect(normalizeSymbol("ESZ6")).toBe("ES");
    expect(normalizeSymbol("NQ")).toBe("NQ");
    expect(normalizeSymbol("RTY")).toBe("RTY");
    expect(normalizeSymbol("YM")).toBe("YM");
  });

  test("normalizes micro symbols", () => {
    expect(normalizeSymbol("MNQ")).toBe("MNQ");
    expect(normalizeSymbol("MES")).toBe("MES");
    expect(normalizeSymbol("MCL")).toBe("MCL");
    expect(normalizeSymbol("MGC")).toBe("MGC");
    expect(normalizeSymbol("M2K")).toBe("M2K");
    expect(normalizeSymbol("MYM")).toBe("MYM");
  });

  test("MNQ does NOT normalize to NQ", () => {
    expect(normalizeSymbol("MNQ.M26")).toBe("MNQ");
    expect(normalizeSymbol("MNQ")).not.toBe("NQ");
  });

  test("strips .Z25 contract suffix", () => {
    expect(normalizeSymbol("ES.Z25")).toBe("ES");
    expect(normalizeSymbol("MES.Z25")).toBe("MES");
  });
});

// ============================================================
// parseOrderIdFormat tests
// ============================================================
describe("parseOrderIdFormat", () => {
  test("parses the user's exact 22-line input correctly", () => {
    const lines = USER_DATA.split("\n");
    const result = parseOrderIdFormat(lines);

    expect(result).toHaveLength(22);
    // All should be MNQ
    expect(result.every((e) => e.symbol === "MNQ")).toBe(true);
    // All quantities should be valid numbers
    expect(result.every((e) => !isNaN(e.quantity))).toBe(true);
    // All fillPrices should be valid numbers
    expect(result.every((e) => !isNaN(e.fillPrice))).toBe(true);
  });

  test("correctly parses sides from the 22-line input", () => {
    const lines = USER_DATA.split("\n");
    const result = parseOrderIdFormat(lines);

    // First line is SOLD → SELL
    expect(result[0].side).toBe("SELL");
    // ORD_055 is BOUGHT → BUY
    expect(result[3].side).toBe("BUY");
    // ORD_072 is BOUGHT → BUY
    expect(result[20].side).toBe("BUY");
    // ORD_073 is SOLD → SELL
    expect(result[21].side).toBe("SELL");
  });

  test("correctly parses prices from the 22-line input", () => {
    const lines = USER_DATA.split("\n");
    const result = parseOrderIdFormat(lines);

    expect(result[0].fillPrice).toBe(28627.0);
    expect(result[1].fillPrice).toBe(28626.75);
    expect(result[2].fillPrice).toBe(28601.5);
    expect(result[3].fillPrice).toBe(28571.25);
    expect(result[20].fillPrice).toBe(28549.5);
    expect(result[21].fillPrice).toBe(28590.5);
  });

  test("correctly parses quantities", () => {
    const lines = USER_DATA.split("\n");
    const result = parseOrderIdFormat(lines);

    // ORD_054 has qty 2
    expect(result[2].quantity).toBe(2);
    // ORD_058 has qty 2
    expect(result[6].quantity).toBe(2);
    // Most are qty 1
    expect(result[0].quantity).toBe(1);
  });

  test("date + time → correct timestamp (local time)", () => {
    const lines = USER_DATA.split("\n");
    const result = parseOrderIdFormat(lines);

    // First data line: 06/10/2026 12:50:13
    const ts = result[0].timestamp;
    expect(ts.getFullYear()).toBe(2026);
    expect(ts.getMonth()).toBe(5); // June (0-indexed)
    expect(ts.getDate()).toBe(10);
    expect(ts.getHours()).toBe(12);
    expect(ts.getMinutes()).toBe(50);
    expect(ts.getSeconds()).toBe(13);
  });

  test("each data line gets its own timestamp from its own date+time", () => {
    const lines = USER_DATA.split("\n");
    const result = parseOrderIdFormat(lines);

    // ORD_054: 06/10/2026 12:50:10
    expect(result[2].timestamp.getHours()).toBe(12);
    expect(result[2].timestamp.getMinutes()).toBe(50);
    expect(result[2].timestamp.getSeconds()).toBe(10);

    // ORD_072: 06/10/2026 12:59:49
    expect(result[20].timestamp.getHours()).toBe(12);
    expect(result[20].timestamp.getMinutes()).toBe(59);
    expect(result[20].timestamp.getSeconds()).toBe(49);
  });

  test("detects format by the Order ID header line", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "12:50:13", "ORD_001", "BOUGHT", "1", "MNQ.M26", "28627.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe("BUY");
  });

  test("translates BOUGHT → BUY and SOLD → SELL", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "09:30:00", "A001", "BOUGHT", "1", "MNQ.M26", "28000.00"),
      tabLine("06/10/2026", "09:31:00", "A002", "SOLD", "2", "MES.Z25", "5500.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result[0].side).toBe("BUY");
    expect(result[1].side).toBe("SELL");
  });

  test("strips .M26 contract suffix and normalizes to MNQ", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "09:30:00", "A001", "BOUGHT", "1", "MNQ.M26", "28000.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result[0].symbol).toBe("MNQ");
  });

  test("normalizes MES.Z25 to MES", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "09:30:00", "A001", "BOUGHT", "1", "MES.Z25", "5500.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result[0].symbol).toBe("MES");
  });

  test("empty input (no header line) → empty array", () => {
    expect(parseOrderIdFormat([])).toEqual([]);
    expect(parseOrderIdFormat([""])).toEqual([]);
    expect(parseOrderIdFormat(["BUY 2 ES 5120.00"])).toEqual([]);
  });

  test("header line only (no data lines) → empty array", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
    ];
    expect(parseOrderIdFormat(lines)).toEqual([]);
  });

  test("mixed case Order ID and Bought/Sold (broker variants)", () => {
    const lines = [
      tabLine("Date", "Time", "order id", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "09:30:00", "A001", "Bought", "1", "MNQ.M26", "28000.00"),
      tabLine("06/10/2026", "09:31:00", "A002", "Sold", "1", "MNQ.M26", "28100.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result).toHaveLength(2);
    expect(result[0].side).toBe("BUY");
    expect(result[1].side).toBe("SELL");
  });

  test("returns objects matching ParsedExecution shape", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "09:30:00", "A001", "BOUGHT", "1", "MNQ.M26", "28000.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result).toHaveLength(1);
    const exec = result[0];
    expect(exec).toHaveProperty("side");
    expect(exec).toHaveProperty("symbol");
    expect(exec).toHaveProperty("quantity");
    expect(exec).toHaveProperty("fillPrice");
    expect(exec).toHaveProperty("timestamp");
    expect(typeof exec.side).toBe("string");
    expect(typeof exec.symbol).toBe("string");
    expect(typeof exec.quantity).toBe("number");
    expect(typeof exec.fillPrice).toBe("number");
    expect(exec.timestamp).toBeInstanceOf(Date);
  });

  test("skips blank lines between header and data", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      "",
      "   ",
      tabLine("06/10/2026", "09:30:00", "A001", "BOUGHT", "1", "MNQ.M26", "28000.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result).toHaveLength(1);
  });

  test("handles trailing tabs gracefully", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "09:30:00", "A001", "BOUGHT", "1", "MNQ.M26", "28000.00") + "\t\t",
    ];
    const result = parseOrderIdFormat(lines);
    expect(result).toHaveLength(1);
    expect(result[0].fillPrice).toBe(28000.0);
  });

  test("skips data lines with unrecognized side values", () => {
    const lines = [
      tabLine("Date", "Time", "Order ID", "Side", "Qty", "Symbol", "Price"),
      tabLine("06/10/2026", "09:30:00", "A001", "BOUGHT", "1", "MNQ.M26", "28000.00"),
      tabLine("06/10/2026", "09:31:00", "A002", "UNKNOWN", "1", "MNQ.M26", "28100.00"),
      tabLine("06/10/2026", "09:32:00", "A003", "SOLD", "1", "MNQ.M26", "28200.00"),
    ];
    const result = parseOrderIdFormat(lines);
    expect(result).toHaveLength(2);
  });

  test("does NOT detect format from standard BUY/SELL text (no Order ID header)", () => {
    const lines = [
      "BUY 2 ES M6 5120.00 05/22 10:24:12",
      "SELL 1 NQ Z5 19000.00 05/22 10:25:00",
    ];
    const result = parseOrderIdFormat(lines);
    expect(result).toEqual([]);
  });
});

// ============================================================
// parsePrimaryRegex tests (existing behavior preserved)
// ============================================================
describe("parsePrimaryRegex", () => {
  test("matches BUY pattern", () => {
    const result = parsePrimaryRegex(["BUY 2 ES M6 5120.00 05/22 10:24:12"]);
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe("BUY");
    expect(result[0].quantity).toBe(2);
    expect(result[0].symbol).toBe("ES");
    expect(result[0].fillPrice).toBe(5120.0);
  });

  test("matches SELL/BOT/SLD patterns", () => {
    const result = parsePrimaryRegex([
      "SELL 1 NQ Z5 19000.00 10:25:00",
      "BOT 3 RTY U6 2100.50 11:00:00",
      "SLD 1 YM M6 42000.00 11:30:00",
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].side).toBe("SELL");
    expect(result[1].side).toBe("BUY");
    expect(result[2].side).toBe("SELL");
  });
});

// ============================================================
// parseSimpleSplit tests (existing behavior preserved)
// ============================================================
describe("parseSimpleSplit", () => {
  test("splits on whitespace", () => {
    const result = parseSimpleSplit(["BUY 1 ES 5120.00"]);
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe("BUY");
    expect(result[0].quantity).toBe(1);
    expect(result[0].symbol).toBe("ES");
    expect(result[0].fillPrice).toBe(5120.0);
  });

  test("returns empty for unrecognized lines", () => {
    expect(parseSimpleSplit(["random text"])).toEqual([]);
  });
});
