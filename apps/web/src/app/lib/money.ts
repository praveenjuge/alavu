// Amounts are integer minor units (paise, cents) held as `bigint` end to end, matching
// the server's int64 fields. They are formatted with Intl, which keeps exact decimals
// when given a string, so no amount ever passes through a float.

const digitsCache = new Map<string, number>();

/** Number of digits after the decimal point for an ISO 4217 currency code. */
export function minorDigits(currency: string): number {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    digitsCache.set(currency, digits);
  }
  return digits;
}

/** "-1234.50" for -123450n with 2 digits. */
export function toDecimalString(minor: bigint, digits: number): string {
  const negative = minor < 0n;
  const abs = (negative ? -minor : minor).toString().padStart(digits + 1, "0");
  const whole = digits ? abs.slice(0, -digits) : abs;
  const fraction = digits ? `.${abs.slice(-digits)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function formatMoney(
  minor: bigint,
  currency: string,
  options: { sign?: boolean; locale?: string } = {},
): string {
  const digits = minorDigits(currency);
  const formatter = new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency,
    signDisplay: options.sign ? "exceptZero" : "auto",
  });
  return formatter.format(toDecimalString(minor, digits) as Intl.StringNumericLiteral);
}

/** Short form for chart axes, like "₹30K". Rounding is fine here. */
export function formatCompact(minor: bigint, currency: string, locale?: string): string {
  const value = Number(minor) / 10 ** minorDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumSignificantDigits: 3,
  }).format(value);
}

/**
 * Parses what someone typed into an amount field, in their locale's format, into minor
 * units. Accepts grouping separators and a currency symbol. Returns null when the text
 * isn't an amount; rounds half up to the currency's precision.
 */
export function parseAmount(input: string, currency: string, locale?: string): bigint | null {
  const { group, decimal } = separators(locale);
  let text = input.replace(/[\s  ]/g, "").replace(/[^\d.,'-]/g, "");
  if (group) text = text.split(group).join("");
  if (decimal !== ".") text = text.replace(decimal, ".");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(text)) return null;

  const digits = minorDigits(currency);
  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "0".repeat(digits + 1)).slice(0, digits + 1);
  let minor = BigInt((whole || "0") + padded.slice(0, digits));
  if (Number(padded[digits] ?? "0") >= 5) minor += 1n;
  return minor;
}

function separators(locale?: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

/**
 * The plain number to show in an amount field when editing, like "1234.5", in the form
 * `parseAmount` reads back. Locales that write "1.234,5" get "1234,5": a "." there is a
 * group separator, so "1234.5" would save as 12345.
 */
export function amountInputValue(minor: bigint, currency: string, locale?: string): string {
  let text = toDecimalString(minor, minorDigits(currency));
  if (text.includes(".")) text = text.replace(/\.?0+$/, "");
  return separators(locale).decimal === "," ? text.replace(".", ",") : text;
}
