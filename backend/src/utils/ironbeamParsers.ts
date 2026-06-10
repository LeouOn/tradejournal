/**
 * Ironbeam fill parsers — one function per fallback path.
 * Each function takes the raw lines (already split on \n) and returns
 * an array of parsed executions.
 */

export interface ParsedExecution {
  side: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  fillPrice: number;
  timestamp: Date;
}

/**
 * Normalize a raw futures symbol to its base form.
 * Strips contract-month suffixes like ".M26", "M6", "Z25", etc.
 * Also normalizes micro variants.
 */
export function normalizeSymbol(symbolRaw: string): string {
  const upper = symbolRaw.toUpperCase();
  // Strip dot-contract suffixes like .M26
  const base = upper.replace(/\.[A-Z]\d{2}$/, "");
  // Normalize by prefix
  if (base.startsWith("ES")) return "ES";
  if (base.startsWith("NQ")) return "NQ";
  if (base.startsWith("RTY")) return "RTY";
  if (base.startsWith("YM")) return "YM";
  if (base.startsWith("MNQ")) return "MNQ";
  if (base.startsWith("MES")) return "MES";
  if (base.startsWith("MCL")) return "MCL";
  if (base.startsWith("MGC")) return "MGC";
  if (base.startsWith("M2K")) return "M2K";
  if (base.startsWith("MYM")) return "MYM";
  return base;
}

/**
 * Parser 1: Primary regex — matches BUY/SELL/BOT/SLD first-token pattern
 * e.g. "BUY 2 ES M6 5120.00 05/22 10:24:12"
 */
export function parsePrimaryRegex(lines: string[]): ParsedExecution[] {
  const parsedExecutions: ParsedExecution[] = [];

  for (const line of lines) {
    const cleanLine = line.toUpperCase().trim();
    if (!cleanLine) continue;

    const regex =
      /(BUY|SELL|BOT|SLD)\s+(\d+)\s+([A-Z0-9\s]+?)\s+(\d+(?:\.\d+)?)\s+(?:(?:\d{2}\/\d{2})\s+)?(\d{2}:\d{2}:\d{2})/;
    const match = cleanLine.match(regex);

    if (match) {
      const sideRaw = match[1];
      const side =
        sideRaw === "BUY" || sideRaw === "BOT" ? "BUY" : "SELL";
      const quantity = parseInt(match[2], 10);
      const symbolRaw = match[3];
      const fillPrice = parseFloat(match[4]);
      const timeStr = match[5];

      let symbol = symbolRaw;
      if (symbolRaw.startsWith("ES")) symbol = "ES";
      else if (symbolRaw.startsWith("NQ")) symbol = "NQ";
      else if (symbolRaw.startsWith("RTY")) symbol = "RTY";
      else if (symbolRaw.startsWith("YM")) symbol = "YM";

      const dateStr = new Date().toLocaleDateString();
      const timestamp = new Date(`${dateStr} ${timeStr}`);

      parsedExecutions.push({
        side,
        symbol,
        quantity,
        fillPrice,
        timestamp,
      });
    }
  }

  return parsedExecutions;
}

/**
 * Parser 2: Daily-statement confirmation format fallback
 * Triggered by "THE FOLLOWING TRADES HAVE BEEN POSTED TO YOUR ACCOUNT"
 */
export function parseDailyStatement(
  lines: string[],
  rawText: string
): ParsedExecution[] {
  const parsedExecutions: ParsedExecution[] = [];

  let statementDate = new Date();
  const dateHeaderMatch = rawText.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d+),\s+(\d{4})/i
  );
  if (dateHeaderMatch) {
    statementDate = new Date(
      `${dateHeaderMatch[1]} ${dateHeaderMatch[2]} ${dateHeaderMatch[3]}`
    );
  }

  let inTradesSection = false;
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    if (
      line.includes(
        "THE FOLLOWING TRADES HAVE BEEN POSTED TO YOUR ACCOUNT"
      )
    ) {
      inTradesSection = true;
      continue;
    }
    if (
      inTradesSection &&
      (line.includes("MATURITY:") ||
        line.includes("USD FUTURE COMMISSION") ||
        line.includes("<<<<<<<<<< PURCHASE AND SALE >>>>>>>>>>"))
    ) {
      inTradesSection = false;
    }

    if (inTradesSection) {
      const genericMatch = line.match(
        /^(\s*)(\d+)\s+(?:CME|ICE|CBOT|NYMEX|COMEX|USD)\s+(.+?)\s+([A-Z]{3}\d{2})\s+(\d+(?:\.\d+)?)/i
      );
      if (genericMatch) {
        const qtyStr = genericMatch[2];
        const desc = genericMatch[3].trim();
        const price = parseFloat(genericMatch[5]);

        const firstNumIndex = line.indexOf(qtyStr);
        let side: "BUY" | "SELL" = "BUY";
        if (firstNumIndex >= 10) {
          side = "SELL";
        }
        const quantity = parseInt(qtyStr, 10);

        let symbol = "MNQ";
        const upperDesc = desc.toUpperCase();
        if (upperDesc.includes("MICRO E-MINI NASDAQ") || upperDesc.includes("MNQ"))
          symbol = "MNQ";
        else if (upperDesc.includes("E-MINI NASDAQ") || upperDesc.includes("NQ"))
          symbol = "NQ";
        else if (upperDesc.includes("MICRO E-MINI S&P") || upperDesc.includes("MES"))
          symbol = "MES";
        else if (upperDesc.includes("E-MINI S&P") || upperDesc.includes("ES"))
          symbol = "ES";
        else if (upperDesc.includes("MICRO E-MINI RUSSELL") || upperDesc.includes("M2K"))
          symbol = "M2K";
        else if (upperDesc.includes("E-MINI RUSSELL") || upperDesc.includes("RTY"))
          symbol = "RTY";
        else if (upperDesc.includes("MICRO E-MINI DOW") || upperDesc.includes("MYM"))
          symbol = "MYM";
        else if (upperDesc.includes("E-MINI DOW") || upperDesc.includes("YM"))
          symbol = "YM";
        else if (upperDesc.includes("MICRO CRUDE") || upperDesc.includes("MCL"))
          symbol = "MCL";
        else if (upperDesc.includes("CRUDE") || upperDesc.includes("CL"))
          symbol = "CL";
        else if (upperDesc.includes("MICRO GOLD") || upperDesc.includes("MGC"))
          symbol = "MGC";
        else if (upperDesc.includes("GOLD") || upperDesc.includes("GC"))
          symbol = "GC";
        else if (upperDesc.includes("NATURAL GAS") || upperDesc.includes("NG"))
          symbol = "NG";

        const timeOffset = parsedExecutions.length * 60 * 1000;
        const timestamp = new Date(
          statementDate.getTime() + 9 * 60 * 60 * 1000 + timeOffset
        );

        parsedExecutions.push({
          side,
          symbol,
          quantity,
          fillPrice: price,
          timestamp,
        });
      }
    }
  }

  return parsedExecutions;
}

/**
 * Parser 3: Simple whitespace-split fallback
 * Splits on whitespace, takes parts[0] as side, parts[1] as qty, etc.
 */
export function parseSimpleSplit(lines: string[]): ParsedExecution[] {
  const parsedExecutions: ParsedExecution[] = [];

  lines.forEach((line: string) => {
    const parts = line.split(/[,\t\s]+/);
    if (parts.length >= 4) {
      const sideCandidate = parts[0].toUpperCase();
      const side =
        sideCandidate.startsWith("B") ||
        sideCandidate.startsWith("BUY") ||
        sideCandidate.startsWith("BOT")
          ? "BUY"
          : sideCandidate.startsWith("S") ||
            sideCandidate.startsWith("SELL") ||
            sideCandidate.startsWith("SLD")
            ? "SELL"
            : null;
      const qty = parseInt(parts[1], 10);
      const symbolRaw = parts[2].toUpperCase();
      const price = parseFloat(parts[3]);
      if (side && !isNaN(qty) && symbolRaw && !isNaN(price)) {
        let symbol = symbolRaw;
        if (symbolRaw.startsWith("ES")) symbol = "ES";
        else if (symbolRaw.startsWith("NQ")) symbol = "NQ";
        else if (symbolRaw.startsWith("RTY")) symbol = "RTY";
        else if (symbolRaw.startsWith("YM")) symbol = "YM";

        parsedExecutions.push({
          side,
          symbol,
          quantity: qty,
          fillPrice: price,
          timestamp: new Date(),
        });
      }
    }
  });

  return parsedExecutions;
}

/**
 * Parser 4: Order-ID tab-separated format
 * Detected by a header line containing "Order ID" (case-insensitive).
 * Data lines: [date] [time] [order_id] [side] [qty] [symbol] [price]
 * Sides: BOUGHT → BUY, SOLD → SELL
 */
export function parseOrderIdFormat(lines: string[]): ParsedExecution[] {
  const parsedExecutions: ParsedExecution[] = [];

  // Find the header line containing "Order ID" (case-insensitive)
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const columns = trimmed.split(/\t/);
    if (columns.some((col) => col.trim().toLowerCase() === "order id")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return parsedExecutions;

  // Parse data lines after the header
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    const columns = trimmed.split(/\t/);
    if (columns.length < 7) continue;

    const dateStr = columns[0].trim();
    const timeStr = columns[1].trim();
    // columns[2] is order_id — we don't need it
    const sideRaw = columns[3].trim().toUpperCase();
    const qtyStr = columns[4].trim();
    const symbolRaw = columns[5].trim();
    const priceStr = columns[6].trim();

    // Validate side
    let side: "BUY" | "SELL";
    if (sideRaw === "BOUGHT" || sideRaw === "BUY" || sideRaw === "BOT" || sideRaw === "B") {
      side = "BUY";
    } else if (sideRaw === "SOLD" || sideRaw === "SELL" || sideRaw === "SLD" || sideRaw === "S") {
      side = "SELL";
    } else {
      continue; // Skip lines with unrecognized side
    }

    const quantity = parseInt(qtyStr, 10);
    const fillPrice = parseFloat(priceStr);
    if (isNaN(quantity) || isNaN(fillPrice)) continue;

    // Normalize symbol: strip contract suffix like .M26
    const symbol = normalizeSymbol(symbolRaw);

    // Parse date: MM/DD/YYYY + HH:MM:SS → local time
    const dateMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const timeMatch = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) continue;

    const [, mm, dd, yyyy] = dateMatch;
    const [, hh, mi, ss] = timeMatch;
    const timestamp = new Date(
      `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`
    );

    parsedExecutions.push({
      side,
      symbol,
      quantity,
      fillPrice,
      timestamp,
    });
  }

  return parsedExecutions;
}
