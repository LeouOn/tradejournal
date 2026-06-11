import { preformatIronbeamFills, PreformatResult } from "../utils/ironbeamPreformatter";

// ============================================================
// New format: Timestamp (UTC) | Side | Quantity | Symbol | Price
// (no Order ID column, ISO-style timestamps)
// ============================================================

const NEW_FORMAT_INPUT = `Timestamp (UTC)\tSide\tQuantity\tSymbol\tPrice
2026-06-11 11:46:19\tBOUGHT\t2\tMNQ.M26\t29248.25
2026-06-11 11:47:03\tSOLD\t1\tMNQ.M26\t29250.50
2026-06-11 11:48:15\tBOUGHT\t3\tMNQ.M28\t29300.00`;

// Existing format: Date | Time | Order ID | Side | Qty | Symbol | Price
// (what parseOrderIdFormat already handles)
const EXISTING_FORMAT_INPUT = `Date\tTime\tOrder ID\tSide\tQty\tSymbol\tPrice
06/10/2026\t12:50:13\tORD_052\tSOLD\t1\tMNQ.M26\t28627.00
06/10/2026\t12:50:13\tORD_053\tSOLD\t1\tMNQ.M26\t28626.75`;

// Simulated 55-row user data in the new format
function generate55Rows(): string {
  const header = "Timestamp (UTC)\tSide\tQuantity\tSymbol\tPrice";
  const rows: string[] = [header];
  for (let i = 0; i < 55; i++) {
    const side = i % 3 === 0 ? "BOUGHT" : "SOLD";
    const qty = (i % 4) + 1;
    const symbol = i % 5 === 0 ? "MNQ.M28" : "MNQ.M26";
    const price = (29200 + i * 1.25).toFixed(2);
    const hour = 11 + Math.floor(i / 30);
    const min = i % 60;
    const sec = i % 60;
    const ts = `2026-06-11 ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    rows.push(`${ts}\t${side}\t${qty}\t${symbol}\t${price}`);
  }
  return rows.join("\n");
}

// ============================================================
// Tests
// ============================================================

describe("preformatIronbeamFills", () => {
  // ----------------------------------------------------------
  // Detection of new format (Timestamp | Side | Quantity | Symbol | Price)
  // ----------------------------------------------------------
  test("detects new format header and produces canonical output", () => {
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    expect(result.rowCount).toBe(3);
    expect(result.warnings).toHaveLength(0);

    const lines = result.canonicalText.split("\n");
    // Header + 3 data rows
    expect(lines).toHaveLength(4);
    // Header should be canonical
    expect(lines[0]).toBe("Date\tTime\tOrder ID\tSide\tQty\tSymbol\tPrice");
  });

  // ----------------------------------------------------------
  // ISO timestamp → MM/DD/YYYY + HH:MM:SS split
  // ----------------------------------------------------------
  test("parses ISO timestamp 2026-06-11 11:46:19 into two columns", () => {
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    const lines = result.canonicalText.split("\n");
    // First data row
    const dataLine = lines[1];
    const cols = dataLine.split("\t");
    expect(cols[0]).toBe("06/11/2026"); // Date
    expect(cols[1]).toBe("11:46:19");   // Time
  });

  // ----------------------------------------------------------
  // Side preservation: BOUGHT/SOLD pass through
  // ----------------------------------------------------------
  test("preserves BOUGHT and SOLD side values", () => {
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    const lines = result.canonicalText.split("\n");
    const row1 = lines[1].split("\t");
    const row2 = lines[2].split("\t");
    expect(row1[3]).toBe("BOUGHT");
    expect(row2[3]).toBe("SOLD");
  });

  // ----------------------------------------------------------
  // Symbol preservation: MNQ.M26 stays MNQ.M26
  // ----------------------------------------------------------
  test("preserves symbol as-is (does not strip .M26)", () => {
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    const lines = result.canonicalText.split("\n");
    const row1 = lines[1].split("\t");
    expect(row1[5]).toBe("MNQ.M26");
    const row3 = lines[3].split("\t");
    expect(row3[5]).toBe("MNQ.M28");
  });

  // ----------------------------------------------------------
  // Order ID generation: ORD_001, ORD_002, ...
  // ----------------------------------------------------------
  test("generates ORD_001, ORD_002, ... when no Order ID column exists", () => {
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    const lines = result.canonicalText.split("\n");
    const row1 = lines[1].split("\t");
    const row2 = lines[2].split("\t");
    const row3 = lines[3].split("\t");
    expect(row1[2]).toBe("ORD_001");
    expect(row2[2]).toBe("ORD_002");
    expect(row3[2]).toBe("ORD_003");
  });

  // ----------------------------------------------------------
  // Existing format pass-through (Date|Time|Order ID|Side|Qty|Symbol|Price)
  // ----------------------------------------------------------
  test("handles existing Order ID format and produces canonical output", () => {
    const result = preformatIronbeamFills(EXISTING_FORMAT_INPUT);
    expect(result.rowCount).toBe(2);

    const lines = result.canonicalText.split("\n");
    expect(lines[0]).toBe("Date\tTime\tOrder ID\tSide\tQty\tSymbol\tPrice");
    const row1 = lines[1].split("\t");
    expect(row1[0]).toBe("06/10/2026");
    expect(row1[1]).toBe("12:50:13");
    expect(row1[2]).toBe("ORD_052");
    expect(row1[3]).toBe("SOLD");
    expect(row1[4]).toBe("1");
    expect(row1[5]).toBe("MNQ.M26");
    expect(row1[6]).toBe("28627.00");
  });

  // ----------------------------------------------------------
  // Case-insensitive header matching
  // ----------------------------------------------------------
  test("matches headers case-insensitively", () => {
    const input = `timestamp (utc)\tside\tquantity\tsymbol\tprice
2026-06-11 11:46:19\tBOUGHT\t2\tMNQ.M26\t29248.25`;
    const result = preformatIronbeamFills(input);
    expect(result.rowCount).toBe(1);
    const row = result.canonicalText.split("\n")[1].split("\t");
    expect(row[3]).toBe("BOUGHT");
  });

  // ----------------------------------------------------------
  // Missing required column → rowCount: 0 + warning
  // ----------------------------------------------------------
  test("returns rowCount 0 and warning when required column is missing", () => {
    // No side column at all
    const input = `Timestamp (UTC)\tQuantity\tSymbol\tPrice
2026-06-11 11:46:19\t2\tMNQ.M26\t29248.25`;
    const result = preformatIronbeamFills(input);
    expect(result.rowCount).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // Empty input
  // ----------------------------------------------------------
  test("returns rowCount 0 for empty input", () => {
    const result = preformatIronbeamFills("");
    expect(result.rowCount).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // Single column input (garbage)
  // ----------------------------------------------------------
  test("returns rowCount 0 for single-column garbage input", () => {
    const result = preformatIronbeamFills("random\ngarbage\ninput");
    expect(result.rowCount).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // detectedColumns reflects the input
  // ----------------------------------------------------------
  test("detectedColumns reflects parsed header for new format", () => {
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    expect(result.detectedColumns.timestamp).toBeTruthy();
    expect(result.detectedColumns.side).toBeTruthy();
    expect(result.detectedColumns.quantity).toBeTruthy();
    expect(result.detectedColumns.symbol).toBeTruthy();
    expect(result.detectedColumns.price).toBeTruthy();
    // No order id column in new format
    expect(result.detectedColumns.orderId).toBeNull();
  });

  test("detectedColumns reflects parsed header for existing format", () => {
    const result = preformatIronbeamFills(EXISTING_FORMAT_INPUT);
    expect(result.detectedColumns.timestamp).toBeTruthy();
    expect(result.detectedColumns.side).toBeTruthy();
    expect(result.detectedColumns.orderId).toBeTruthy();
  });

  // ----------------------------------------------------------
  // 55-row user data
  // ----------------------------------------------------------
  test("produces 55 canonical rows from 55-row input", () => {
    const input = generate55Rows();
    const result = preformatIronbeamFills(input);
    expect(result.rowCount).toBe(55);
    expect(result.warnings).toHaveLength(0);

    const lines = result.canonicalText.split("\n");
    expect(lines).toHaveLength(56); // header + 55 rows
    // Verify first data row has generated Order ID
    const firstRow = lines[1].split("\t");
    expect(firstRow[2]).toBe("ORD_001");
    // Verify last data row
    const lastRow = lines[55].split("\t");
    expect(lastRow[2]).toBe("ORD_055");
  });

  // ----------------------------------------------------------
  // Side variants: BUY, SELL, BOT, SLD, B, S → canonical BOUGHT/SOLD
  // ----------------------------------------------------------
  test("normalizes BUY→BOUGHT, SELL→SOLD, BOT→BOUGHT, SLD→SOLD, B→BOUGHT, S→SOLD", () => {
    const input = `Timestamp (UTC)\tSide\tQuantity\tSymbol\tPrice
2026-06-11 09:30:00\tBUY\t1\tMNQ.M26\t29000.00
2026-06-11 09:31:00\tSELL\t1\tMNQ.M26\t29050.00
2026-06-11 09:32:00\tBOT\t2\tMNQ.M26\t29100.00
2026-06-11 09:33:00\tSLD\t2\tMNQ.M26\t29150.00
2026-06-11 09:34:00\tB\t1\tMNQ.M26\t29200.00
2026-06-11 09:35:00\tS\t1\tMNQ.M26\t29250.00`;
    const result = preformatIronbeamFills(input);
    expect(result.rowCount).toBe(6);
    const lines = result.canonicalText.split("\n");
    expect(lines[1].split("\t")[3]).toBe("BOUGHT");
    expect(lines[2].split("\t")[3]).toBe("SOLD");
    expect(lines[3].split("\t")[3]).toBe("BOUGHT");
    expect(lines[4].split("\t")[3]).toBe("SOLD");
    expect(lines[5].split("\t")[3]).toBe("BOUGHT");
    expect(lines[6].split("\t")[3]).toBe("SOLD");
  });

  // ----------------------------------------------------------
  // US-style separate date+time columns (MM/DD/YYYY + HH:MM:SS)
  // ----------------------------------------------------------
  test("handles US-style Date + Time as separate columns (no reformatting needed)", () => {
    const input = `Date\tTime\tSide\tQty\tSymbol\tPrice
06/11/2026\t11:46:19\tBOUGHT\t2\tMNQ.M26\t29248.25`;
    const result = preformatIronbeamFills(input);
    expect(result.rowCount).toBe(1);
    const row = result.canonicalText.split("\n")[1].split("\t");
    expect(row[0]).toBe("06/11/2026");
    expect(row[1]).toBe("11:46:19");
  });

  // ----------------------------------------------------------
  // Header with extra whitespace
  // ----------------------------------------------------------
  test("handles headers with extra whitespace", () => {
    const input = `  Timestamp (UTC)  \t  Side  \t  Quantity  \t  Symbol  \t  Price  
2026-06-11 11:46:19\tBOUGHT\t2\tMNQ.M26\t29248.25`;
    const result = preformatIronbeamFills(input);
    expect(result.rowCount).toBe(1);
  });

  // ----------------------------------------------------------
  // Never throws — always returns a result
  // ----------------------------------------------------------
  test("never throws on any input — returns result with rowCount 0", () => {
    expect(() => preformatIronbeamFills("")).not.toThrow();
    expect(() => preformatIronbeamFills("just\tsome\trandom\ttext")).not.toThrow();
    expect(() => preformatIronbeamFills("a")).not.toThrow();
  });

  // ----------------------------------------------------------
  // Canonical output is parseable by parseOrderIdFormat
  // ----------------------------------------------------------
  test("canonical output from new format is parseable by parseOrderIdFormat", async () => {
    const { parseOrderIdFormat } = await import("../utils/ironbeamParsers");
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    const lines = result.canonicalText.split("\n");
    const parsed = parseOrderIdFormat(lines);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].side).toBe("BUY");
    expect(parsed[1].side).toBe("SELL");
    expect(parsed[0].symbol).toBe("MNQ");
    expect(parsed[0].quantity).toBe(2);
    expect(parsed[0].fillPrice).toBe(29248.25);
  });

  // ----------------------------------------------------------
  // Price and quantity preserved exactly
  // ----------------------------------------------------------
  test("preserves price and quantity exactly in canonical output", () => {
    const result = preformatIronbeamFills(NEW_FORMAT_INPUT);
    const lines = result.canonicalText.split("\n");
    const row1 = lines[1].split("\t");
    expect(row1[4]).toBe("2");           // Qty
    expect(row1[6]).toBe("29248.25");    // Price
  });
});
