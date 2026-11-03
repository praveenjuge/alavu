import { describe, expect, test } from "vitest";
import { amountInputValue, formatMoney, parseAmount, toDecimalString } from "./money";
import { nextPeriod, periodContaining, periodDays, previousPeriod } from "./period";
import { budgetStatus, type Entry, summarize } from "./summary";

describe("money", () => {
  test("formats minor units exactly, with lakh grouping for Indian English", () => {
    expect(formatMoney(12_000_000n, "INR", { locale: "en-IN" })).toBe("₹1,20,000.00");
    expect(formatMoney(123_456_789_012_345n, "USD", { locale: "en-US" })).toBe(
      "$1,234,567,890,123.45",
    );
    expect(formatMoney(500n, "JPY", { locale: "en-US" })).toBe("¥500");
    expect(formatMoney(1_250n, "KWD", { locale: "en-US" })).toBe("KWD\u00a01.250");
    expect(formatMoney(-4_550n, "INR", { locale: "en-IN" })).toBe("-₹45.50");
    expect(formatMoney(4_550n, "INR", { locale: "en-IN", sign: true })).toBe("+₹45.50");
  });

  test("parses what people type without floating point", () => {
    expect(parseAmount("1,20,000", "INR", "en-IN")).toBe(12_000_000n);
    expect(parseAmount("0.1", "USD", "en-US")).toBe(10n);
    expect(parseAmount("19.999", "USD", "en-US")).toBe(2_000n);
    expect(parseAmount("₹ 45.5", "INR", "en-IN")).toBe(4_550n);
    expect(parseAmount("1.234,5", "EUR", "de-DE")).toBe(123_450n);
    expect(parseAmount("500", "JPY", "en-US")).toBe(500n);
    expect(parseAmount("", "USD", "en-US")).toBeNull();
    expect(parseAmount("abc", "USD", "en-US")).toBeNull();
    expect(toDecimalString(5n, 2)).toBe("0.05");
  });

  test("an amount shown for editing reads back unchanged in every locale", () => {
    for (const locale of ["en-US", "en-IN", "de-DE", "es-ES", "pt-BR", "fr-FR", "de-CH"]) {
      for (const [minor, currency] of [
        [123_450n, "EUR"],
        [4_550n, "INR"],
        [100_00n, "USD"],
        [500n, "JPY"],
        [1_250n, "KWD"],
      ] as const) {
        expect(parseAmount(amountInputValue(minor, currency, locale), currency, locale)).toBe(
          minor,
        );
      }
    }
    expect(amountInputValue(123_450n, "EUR", "de-DE")).toBe("1234,5");
    expect(amountInputValue(123_450n, "EUR", "en-US")).toBe("1234.5");
  });
});

describe("periods", () => {
  test("calendar months with start day 1", () => {
    const p = periodContaining("2026-11-02", 1);
    expect(p).toEqual({ start: "2026-11-01", end: "2026-12-01", startDay: 1 });
    expect(periodDays(p)).toHaveLength(30);
  });

  test("payday months run from the start day to the day before", () => {
    expect(periodContaining("2026-11-02", 25)).toMatchObject({
      start: "2026-10-25",
      end: "2026-11-25",
    });
    expect(periodContaining("2026-11-25", 25)).toMatchObject({
      start: "2026-11-25",
      end: "2026-12-25",
    });
    expect(periodContaining("2026-01-10", 25)).toMatchObject({
      start: "2025-12-25",
      end: "2026-01-25",
    });
  });

  test("stepping across years", () => {
    const p = periodContaining("2026-12-30", 1);
    expect(nextPeriod(p).start).toBe("2027-01-01");
    expect(previousPeriod(periodContaining("2026-01-05", 1)).start).toBe("2025-12-01");
  });
});

describe("summary", () => {
  const entry = (
    kind: Entry["kind"],
    amountMinor: bigint,
    occurredOn: string,
    categoryUid?: string,
  ) =>
    ({
      kind,
      amountMinor,
      occurredOn,
      categoryUid,
      currency: "INR",
      title: "x",
      receiptKeys: [],
    }) as unknown as Entry;

  test("totals by kind, day and category inside the period only", () => {
    const period = periodContaining("2026-11-02", 25);
    const s = summarize(
      [
        entry("income", 120_000_00n, "2026-10-25"),
        entry("expense", 2_000_00n, "2026-11-01", "transport"),
        entry("expense", 500_00n, "2026-11-01", "food"),
        entry("expense", 1_000_00n, "2026-11-02", "transport"),
        entry("transferOut", 5_000_00n, "2026-10-28"),
        entry("expense", 9_999_00n, "2026-10-24"),
      ],
      period,
    );
    expect(s.expense).toBe(3_500_00n);
    expect(s.net).toBe(120_000_00n - 3_500_00n - 5_000_00n);
    expect(s.daily.get("2026-11-01")).toBe(2_500_00n);
    expect(s.byCategory[0]).toEqual({ categoryUid: "transport", amount: 3_000_00n });

    expect(budgetStatus(s, { categoryUid: "transport", amountMinor: 4_000_00n }).level).toBe(
      "approaching",
    );
    expect(budgetStatus(s, { categoryUid: undefined, amountMinor: 3_000_00n }).level).toBe("over");
    expect(budgetStatus(s, { categoryUid: "food", amountMinor: 5_000_00n }).level).toBe("within");
  });
});
