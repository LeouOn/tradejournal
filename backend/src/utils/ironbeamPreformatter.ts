/**
 * Ironbeam fill preformatter — normalizes arbitrary broker fill exports
 * to a canonical tab-separated format that parseOrderIdFormat can handle.
 *
 * Canonical output columns:
 *   Date\tTime\tOrder ID\tSide\tQty\tSymbol\tPrice
 *   MM/DD/YYYY\tHH:MM:SS\tORD_...\tBOUGHT|SOLD\tN\tSYMBOL\tPRICE
 */

export interface PreformatResult {
  /** Canonical tab-separated text in the format parseOrderIdFormat expects */
  canonicalText: string;
  /** Number of data rows (excluding header) */
  rowCount: number;
  /** Warnings about the input, e.g. unrecognized columns */
  warnings: string[];
  /** Detected column mapping for debugging */
  detectedColumns: {
    timestamp: string | null;
    side: string | null;
    quantity: string | null;
    symbol: string | null;
    price: string | null;
    orderId: string | null;
  };
}

/** Column role detected by header matching */
interface ColumnMapping {
  role: "date" | "time" | "timestamp" | "side" | "quantity" | "symbol" | "price" | "orderId" | "unknown";
  headerIndex: number;
}

/**
 * Classify a single header cell into a column role.
 * Case-insensitive, fuzzy matching.
 */
function classifyHeader(header: string): ColumnMapping["role"] {
  const h = header.trim().toLowerCase();

  // Order ID — check before generic "order" to be precise
  if (h === "order id" || h === "orderid" || h === "ticket" || h === "id") return "orderId";

  // Timestamp (combined date+time)
  if (h === "timestamp" || h === "timestamp (utc)" || h === "datetime" || h === "date/time") return "timestamp";

  // Separate date column
  if (h === "date" || h === "trade date" || h === "fill date") return "date";

  // Separate time column
  if (h === "time" || h === "trade time" || h === "fill time") return "time";

  // Side
  if (h === "side" || h === "action" || h === "direction" || h === "buy/sell" || h === "b/s") return "side";

  // Quantity
  if (h === "qty" || h === "quantity" || h === "size" || h === "contracts" || h === "lots" || h === "volume") return "quantity";

  // Symbol
  if (h === "symbol" || h === "instrument" || h === "ticker" || h === "contract" || h === "product") return "symbol";

  // Price — check after symbol to avoid "fill price" being too greedy
  if (h === "price" || h === "fill price" || h === "fill_price" || h === "fill" || h === "exec price" || h === "last price") return "price";

  // Fuzzy: contains keywords
  if (h.includes("order") && h.includes("id")) return "orderId";
  if (h.includes("order") || h.includes("ticket")) return "orderId";
  if (h.includes("timestamp") || h.includes("date/time") || h.includes("date time")) return "timestamp";
  if (h.includes("date") && !h.includes("update")) return "date";
  if (h.includes("time")) return "time";
  if (h.includes("side") || h.includes("direction") || h.includes("action")) return "side";
  if (h.includes("qty") || h.includes("quantity") || h.includes("size") || h.includes("contract") || h.includes("volume")) return "quantity";
  if (h.includes("symbol") || h.includes("instrument") || h.includes("ticker")) return "symbol";
  if (h.includes("price") || h.includes("fill")) return "price";

  return "unknown";
}

/**
 * Normalize a side value to BOUGHT or SOLD.
 */
function normalizeSide(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (upper === "BOUGHT" || upper === "BUY" || upper === "BOT" || upper === "B") return "BOUGHT";
  if (upper === "SOLD" || upper === "SELL" || upper === "SLD" || upper === "S") return "SOLD";
  return upper; // Unknown — let downstream parser handle it
}

/**
 * Convert YYYY-MM-DD HH:MM:SS → MM/DD/YYYY and HH:MM:SS
 * If already MM/DD/YYYY, return as-is.
 */
function splitTimestamp(raw: string): { date: string; time: string } | null {
  const trimmed = raw.trim();

  // ISO format: YYYY-MM-DD HH:MM:SS
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd, time] = isoMatch;
    return { date: `${mm}/${dd}/${yyyy}`, time };
  }

  // Already MM/DD/YYYY format — just return the date part (shouldn't normally be called)
  const usDateMatch = trimmed.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (usDateMatch) {
    return { date: usDateMatch[1], time: usDateMatch[2] };
  }

  return null;
}

const CANONICAL_HEADER = "Date\tTime\tOrder ID\tSide\tQty\tSymbol\tPrice";

export function preformatIronbeamFills(rawText: string): PreformatResult {
  const result: PreformatResult = {
    canonicalText: "",
    rowCount: 0,
    warnings: [],
    detectedColumns: {
      timestamp: null,
      side: null,
      quantity: null,
      symbol: null,
      price: null,
      orderId: null,
    },
  };

  if (!rawText || !rawText.trim()) {
    result.warnings.push("Empty input");
    return result;
  }

  const lines = rawText.split("\n");

  // Find the first non-empty line as header
  let headerLineIndex = -1;
  let headerRaw = "";
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      headerLineIndex = i;
      headerRaw = lines[i].trim();
      break;
    }
  }

  if (headerLineIndex === -1) {
    result.warnings.push("No header line found");
    return result;
  }

  // Split header — try tab first, then comma, then whitespace
  let headers: string[];
  if (headerRaw.includes("\t")) {
    headers = headerRaw.split("\t").map((h) => h.trim());
  } else if (headerRaw.includes(",")) {
    headers = headerRaw.split(",").map((h) => h.trim());
  } else {
    headers = headerRaw.split(/\s{2,}|\t/).map((h) => h.trim());
  }

  // Classify each header
  const mappings: ColumnMapping[] = headers.map((h, i) => ({
    role: classifyHeader(h),
    headerIndex: i,
  }));

  // Find indices for each required role
  const timestampCol = mappings.find((m) => m.role === "timestamp");
  const dateCol = mappings.find((m) => m.role === "date");
  const timeCol = mappings.find((m) => m.role === "time");
  const sideCol = mappings.find((m) => m.role === "side");
  const qtyCol = mappings.find((m) => m.role === "quantity");
  const symbolCol = mappings.find((m) => m.role === "symbol");
  const priceCol = mappings.find((m) => m.role === "price");
  const orderIdCol = mappings.find((m) => m.role === "orderId");

  // Record detected column names
  result.detectedColumns.timestamp = timestampCol
    ? headers[timestampCol.headerIndex]
    : dateCol
      ? headers[dateCol.headerIndex]
      : null;
  result.detectedColumns.side = sideCol ? headers[sideCol.headerIndex] : null;
  result.detectedColumns.quantity = qtyCol ? headers[qtyCol.headerIndex] : null;
  result.detectedColumns.symbol = symbolCol ? headers[symbolCol.headerIndex] : null;
  result.detectedColumns.price = priceCol ? headers[priceCol.headerIndex] : null;
  result.detectedColumns.orderId = orderIdCol ? headers[orderIdCol.headerIndex] : null;

  // Validate required columns
  const hasTimestamp = timestampCol !== undefined || (dateCol !== undefined && timeCol !== undefined);
  if (!hasTimestamp) result.warnings.push("Missing timestamp/date+time column");
  if (!sideCol) result.warnings.push("Missing side column");
  if (!qtyCol) result.warnings.push("Missing quantity column");
  if (!symbolCol) result.warnings.push("Missing symbol column");
  if (!priceCol) result.warnings.push("Missing price column");

  if (!hasTimestamp || !sideCol || !qtyCol || !symbolCol || !priceCol) {
    return result;
  }

  // Parse data rows
  const canonicalRows: string[] = [CANONICAL_HEADER];
  let ordCounter = 1;

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    let cells: string[];
    if (trimmed.includes("\t")) {
      cells = trimmed.split("\t").map((c) => c.trim());
    } else if (trimmed.includes(",")) {
      cells = trimmed.split(",").map((c) => c.trim());
    } else {
      cells = trimmed.split(/\s{2,}|\t/).map((c) => c.trim());
    }

    // Extract values by role
    let dateStr: string;
    let timeStr: string;

    if (timestampCol) {
      const rawTs = cells[timestampCol.headerIndex] || "";
      const split = splitTimestamp(rawTs);
      if (!split) continue; // Can't parse timestamp — skip row
      dateStr = split.date;
      timeStr = split.time;
    } else {
      dateStr = (cells[dateCol!.headerIndex] || "").trim();
      timeStr = (cells[timeCol!.headerIndex] || "").trim();
      if (!dateStr || !timeStr) continue;
    }

    const sideRaw = (cells[sideCol.headerIndex] || "").trim();
    const side = normalizeSide(sideRaw);
    if (side !== "BOUGHT" && side !== "SOLD") continue; // Skip unrecognized side

    const qty = (cells[qtyCol.headerIndex] || "").trim();
    const symbol = (cells[symbolCol.headerIndex] || "").trim();
    const price = (cells[priceCol.headerIndex] || "").trim();

    if (!qty || !symbol || !price) continue;

    // Order ID — use existing or generate
    let orderId: string;
    if (orderIdCol) {
      orderId = (cells[orderIdCol.headerIndex] || "").trim() || `ORD_${String(ordCounter).padStart(3, "0")}`;
    } else {
      orderId = `ORD_${String(ordCounter).padStart(3, "0")}`;
    }
    ordCounter++;

    canonicalRows.push(`${dateStr}\t${timeStr}\t${orderId}\t${side}\t${qty}\t${symbol}\t${price}`);
  }

  result.canonicalText = canonicalRows.join("\n");
  result.rowCount = canonicalRows.length - 1; // Exclude header

  if (result.rowCount === 0) {
    result.warnings.push("No valid data rows found after header");
  }

  return result;
}
