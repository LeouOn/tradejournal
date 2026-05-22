/**
 * Futures Contract Point Multipliers and Tick Specifications
 */

export interface SymbolSpec {
  multiplier: number;
  tickSize: number;
  tickValue: number;
  name: string;
}

export const SYMBOL_SPECS: { [prefix: string]: SymbolSpec } = {
  MNQ: { multiplier: 2, tickSize: 0.25, tickValue: 0.50, name: "Micro E-mini Nasdaq-100" },
  NQ: { multiplier: 20, tickSize: 0.25, tickValue: 5.00, name: "E-mini Nasdaq-100" },
  MES: { multiplier: 5, tickSize: 0.25, tickValue: 1.25, name: "Micro E-mini S&P 500" },
  ES: { multiplier: 50, tickSize: 0.25, tickValue: 12.50, name: "E-mini S&P 500" },
  M2K: { multiplier: 5, tickSize: 0.1, tickValue: 0.50, name: "Micro E-mini Russell 2000" },
  RTY: { multiplier: 50, tickSize: 0.1, tickValue: 5.00, name: "E-mini Russell 2000" },
  MYM: { multiplier: 0.5, tickSize: 1.0, tickValue: 0.50, name: "Micro E-mini Dow Jones" },
  YM: { multiplier: 5, tickSize: 1.0, tickValue: 5.00, name: "E-mini Dow Jones" },
};

/**
 * Returns the point multiplier for a given symbol.
 * Defaults to 1 for Stocks or other unknown asset classes.
 */
export function getSymbolMultiplier(symbol: string): number {
  const cleanSymbol = symbol.toUpperCase().trim();
  for (const prefix of Object.keys(SYMBOL_SPECS)) {
    if (cleanSymbol.startsWith(prefix)) {
      return SYMBOL_SPECS[prefix].multiplier;
    }
  }
  return 1; // Default multiplier for Stocks/options/other assets
}

/**
 * Returns the tick size for a given symbol.
 * Defaults to 0.01 for standard currency/stock cents.
 */
export function getSymbolTickSize(symbol: string): number {
  const cleanSymbol = symbol.toUpperCase().trim();
  for (const prefix of Object.keys(SYMBOL_SPECS)) {
    if (cleanSymbol.startsWith(prefix)) {
      return SYMBOL_SPECS[prefix].tickSize;
    }
  }
  return 0.01; // Default tick size (cents)
}

/**
 * Validates whether two prices are within a sane proximity threshold (default: 30%)
 * to catch egregious typos (e.g. 299600 instead of 29608).
 * Returns true if sane, false if anomalous.
 */
export function validatePriceProximity(price1: number, price2: number): { isValid: boolean; percentageDelta: number } {
  if (price1 <= 0 || price2 <= 0) {
    return { isValid: true, percentageDelta: 0 };
  }
  const delta = Math.abs(price1 - price2);
  const percentageDelta = delta / price1;
  return {
    isValid: percentageDelta <= 0.30, // 30% threshold
    percentageDelta
  };
}
