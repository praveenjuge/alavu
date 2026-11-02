import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { errorMessage, Field, Group } from "../components/ui";

const fallbackCurrencies = ["INR", "USD", "EUR", "GBP", "AED", "AUD", "CAD", "SGD", "JPY"];

function currencyCodes(): string[] {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return fallbackCurrencies;
  }
}

function localCurrency(): string {
  const region = new Intl.Locale(navigator.language).maximize().region;
  const byRegion: Record<string, string> = {
    IN: "INR",
    US: "USD",
    GB: "GBP",
    AE: "AED",
    AU: "AUD",
    CA: "CAD",
    SG: "SGD",
    JP: "JPY",
  };
  return (region && byRegion[region]) || "USD";
}

export function CurrencySelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const names = new Intl.DisplayNames(undefined, { type: "currency" });
  return (
    <Field label="Currency" htmlFor="currency">
      <select
        id="currency"
        className="select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {currencyCodes().map((code) => (
          <option key={code} value={code}>
            {names.of(code)} ({code})
          </option>
        ))}
      </select>
    </Field>
  );
}

export function MonthStartSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const ordinal = new Intl.PluralRules("en", { type: "ordinal" });
  const suffix: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
  return (
    <Field label="Month Starts On" htmlFor="month-start">
      <select
        id="month-start"
        className="select"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
          <option key={day} value={day}>
            {day === 1 ? "1st (calendar month)" : `${day}${suffix[ordinal.select(day)]}`}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** First run: the currency and month start for the default Personal space. */
export function Setup() {
  const setup = useMutation(api.users.setup);
  const [currency, setCurrency] = useState(localCurrency);
  const [monthStartDay, setMonthStartDay] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      await setup({ currency, monthStartDay });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div style={{ width: "min(520px, 100%)" }}>
        <h1 style={{ fontSize: 32, margin: "0 0 20px" }}>Welcome to Alavu</h1>
        <Group
          header="Your Personal space"
          footer="You can add more spaces later, like Office or Family, each with its own currency."
        >
          <CurrencySelect value={currency} onChange={setCurrency} />
          <MonthStartSelect value={monthStartDay} onChange={setMonthStartDay} />
        </Group>
        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        <Button
          className="button primary"
          style={{ width: "100%", minHeight: 48 }}
          isDisabled={busy}
          onPress={save}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
