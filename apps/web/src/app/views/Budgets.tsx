import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { Plus } from "vadivam-react";
import {
  Badge,
  BudgetBar,
  errorMessage,
  Field,
  Group,
  leftLabel,
  MenuButton,
  PageHeader,
  Row,
  Sheet,
  statusLabel,
  useToast,
} from "../components/ui";
import { useApp } from "../data";
import { budgetUid, remove, upsert } from "../lib/changes";
import { amountInputValue, parseAmount } from "../lib/money";
import { budgetStatus, summarize } from "../lib/summary";
import { PeriodStepper, usePeriod, usePeriodEntries } from "./Overview";

interface Editing {
  categoryUid?: string;
  amount?: bigint;
}

export function Budgets() {
  const { space, budgets, categoryByUid, online } = useApp();
  const stepper = usePeriod();
  const entries = usePeriodEntries(stepper.period);
  const summary = useMemo(
    () => (entries ? summarize(entries, stepper.period) : null),
    [entries, stepper.period],
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const overall = budgets.find((b) => b.categoryUid === undefined);
  const byCategory = budgets.filter(
    (b) => b.categoryUid !== undefined && categoryByUid.has(b.categoryUid),
  );

  const row = (b: (typeof budgets)[number]) => {
    const category = b.categoryUid ? categoryByUid.get(b.categoryUid) : undefined;
    const status = summary ? budgetStatus(summary, b) : null;
    return (
      <Button
        key={b.uid}
        className="row with-icon"
        style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
        onPress={() => setEditing({ categoryUid: b.categoryUid, amount: b.amountMinor })}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Badge symbol={category?.symbol ?? "chart"} />
          <span className="row-text">{category?.name ?? "Monthly Budget"}</span>
          {status && <span className={`status ${status.level}`}>{statusLabel(status)}</span>}
        </span>
        {status && (
          <span style={{ paddingLeft: 44, display: "flex", flexDirection: "column", gap: 6 }}>
            <BudgetBar status={status} />
            <span className="muted num" style={{ fontSize: 13 }}>
              {leftLabel(status, space.currency)}
            </span>
          </span>
        )}
      </Button>
    );
  };

  return (
    <>
      <PageHeader title="Budgets">
        <Button className="button" isDisabled={!online} onPress={() => setEditing({})}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </PageHeader>
      <Group>
        <PeriodStepper stepper={stepper} />
      </Group>
      {budgets.length === 0 ? (
        <Group>
          <p className="empty">Set a monthly budget to see how much is left as you spend.</p>
        </Group>
      ) : (
        <>
          {overall && (
            <Group
              footer={`Covers every expense in ${space.name}. Transfers between spaces don't count.`}
            >
              {row(overall)}
            </Group>
          )}
          {byCategory.length > 0 && <Group header="Categories">{byCategory.map(row)}</Group>}
        </>
      )}
      {editing && <BudgetEditor editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function BudgetEditor({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { space, categories, categoryByUid, budgets, push, online } = useApp();
  const toast = useToast();
  const isNew = editing.amount === undefined;
  const taken = new Set(budgets.map((b) => b.categoryUid ?? ""));
  const choices = categories.filter(
    (c) =>
      c.kind === "expense" &&
      c.archivedAt === undefined &&
      (!taken.has(c.uid) || c.uid === editing.categoryUid),
  );
  // A new budget starts on something that doesn't have one yet, so it never replaces one.
  const [categoryUid, setCategoryUid] = useState(
    isNew ? (taken.has("") ? choices[0]?.uid : undefined) : editing.categoryUid,
  );
  const [amount, setAmount] = useState(
    editing.amount ? amountInputValue(editing.amount, space.currency) : "",
  );
  const minor = parseAmount(amount, space.currency);
  const nothingLeft = isNew && taken.has("") && choices.length === 0;

  async function save(amountMinor: bigint | null) {
    const uid = budgetUid(space.uid, categoryUid);
    try {
      await push([
        amountMinor && amountMinor > 0n
          ? upsert("budgets", uid, { spaceUid: space.uid, categoryUid, amountMinor })
          : remove("budgets", uid),
      ]);
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title={isNew ? "New Budget" : "Edit Budget"}
      action={
        <Button
          className="button primary"
          isDisabled={!online || !minor || nothingLeft}
          onPress={() => save(minor)}
        >
          Save
        </Button>
      }
    >
      <Group footer="Budgets reset when your month starts.">
        {isNew ? (
          <Field label="Applies To">
            <MenuButton
              label="Budget category"
              options={[
                ...(!taken.has("")
                  ? [{ id: "", label: "All Spending", selected: !categoryUid }]
                  : []),
                ...choices.map((c) => ({
                  id: c.uid,
                  label: c.name,
                  selected: c.uid === categoryUid,
                })),
              ]}
              onAction={(id) => setCategoryUid(id || undefined)}
            >
              {categoryUid ? categoryByUid.get(categoryUid)?.name : "All Spending"}
            </MenuButton>
          </Field>
        ) : (
          <Row
            title="Applies To"
            trailing={categoryUid ? categoryByUid.get(categoryUid)?.name : "All Spending"}
          />
        )}
        <Field label={`Monthly limit (${space.currency})`} htmlFor="budget-amount">
          <input
            id="budget-amount"
            className="input num"
            inputMode="decimal"
            placeholder="Amount"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && minor && save(minor)}
          />
        </Field>
      </Group>
      {!isNew && (
        <Group>
          <Row
            onPress={() => save(null)}
            title={<span style={{ color: "var(--red)" }}>Remove Budget</span>}
          />
        </Group>
      )}
    </Sheet>
  );
}
