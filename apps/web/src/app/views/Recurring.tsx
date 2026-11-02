import { useState } from "react";
import { Button } from "react-aria-components";
import { Plus } from "vadivam-react";
import { tints } from "../components/icons";
import {
  Badge,
  errorMessage,
  Field,
  Group,
  MenuButton,
  PageHeader,
  Row,
  Segmented,
  Sheet,
  Toggle,
  useToast,
} from "../components/ui";
import { type RecurringRule, useApp } from "../data";
import { newUid, remove, upsert } from "../lib/changes";
import { amountInputValue, formatMoney, parseAmount } from "../lib/money";
import { dayTitle, today } from "../lib/period";

type Cadence = RecurringRule["cadence"];
const cadenceLabel: Record<Cadence, string> = {
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};
const NEVER = "9999-12-31";

export function Recurring() {
  const { recurringRules, categoryByUid, space, online } = useApp();
  const [editing, setEditing] = useState<{ rule?: RecurringRule } | null>(null);
  return (
    <>
      <PageHeader title="Repeating Entries">
        <Button className="button" isDisabled={!online} onPress={() => setEditing({})}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </PageHeader>
      <p className="muted" style={{ marginTop: -8 }}>
        For {space.name}
      </p>
      <Group footer="Repeating entries are added automatically on their due date, even when the app is closed.">
        {recurringRules.length === 0 && (
          <p className="empty">
            Add rent, salary, or subscriptions once and Alavu logs them for you.
          </p>
        )}
        {recurringRules.map((rule) => {
          const next =
            rule.pausedAt !== undefined
              ? "Paused"
              : rule.nextDueOn === NEVER
                ? "Ended"
                : `Next ${dayTitle(rule.nextDueOn)}`;
          return (
            <Row
              key={rule.uid}
              onPress={() => setEditing({ rule })}
              icon={
                <Badge
                  symbol={categoryByUid.get(rule.categoryUid ?? "")?.symbol ?? "tag"}
                  tint={rule.kind === "income" ? tints.green : undefined}
                />
              }
              title={rule.title}
              subtitle={`${cadenceLabel[rule.cadence]} · ${next}`}
              trailing={
                <span className={`num ${rule.kind === "income" ? "amount-in" : ""}`}>
                  {formatMoney(rule.amountMinor, rule.currency)}
                </span>
              }
            />
          );
        })}
      </Group>
      {editing && <RuleEditor rule={editing.rule} onClose={() => setEditing(null)} />}
    </>
  );
}

function RuleEditor({ rule, onClose }: { rule?: RecurringRule; onClose: () => void }) {
  const { space, categories, categoryByUid, paymentMethods, methodByUid, push, online } = useApp();
  const toast = useToast();
  const currency = rule?.currency ?? space.currency;
  const [kind, setKind] = useState<"expense" | "income">(rule?.kind ?? "expense");
  const [title, setTitle] = useState(rule?.title ?? "");
  const [amount, setAmount] = useState(rule ? amountInputValue(rule.amountMinor, currency) : "");
  const [categoryUid, setCategoryUid] = useState(rule?.categoryUid);
  const [methodUid, setMethodUid] = useState(rule?.paymentMethodUid);
  const [cadence, setCadence] = useState<Cadence>(rule?.cadence ?? "monthly");
  const [startOn, setStartOn] = useState(rule?.startOn ?? today());
  const [paused, setPaused] = useState(rule?.pausedAt !== undefined);
  const minor = parseAmount(amount, currency);
  const choices = categories.filter(
    (c) => c.kind === kind && (c.archivedAt === undefined || c.uid === categoryUid),
  );

  async function run(changes: Parameters<typeof push>[0]) {
    try {
      await push(changes);
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  const save = () =>
    minor &&
    run([
      upsert("recurringRules", rule?.uid ?? newUid(), {
        spaceUid: rule?.spaceUid ?? space.uid,
        kind,
        amountMinor: minor,
        currency,
        title:
          title.trim() ||
          categoryByUid.get(categoryUid ?? "")?.name ||
          (kind === "income" ? "Income" : "Expense"),
        note: rule?.note,
        categoryUid,
        paymentMethodUid: methodUid,
        cadence,
        interval: rule?.interval ?? 1,
        startOn,
        endOn: rule?.endOn,
        pausedAt: paused ? (rule?.pausedAt ?? Date.now()) : undefined,
      }),
    ]);

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title={rule ? "Edit Repeating Entry" : "New Repeating Entry"}
      action={
        <Button
          className="button primary"
          isDisabled={!online || !minor || minor <= 0n}
          onPress={save}
        >
          Save
        </Button>
      }
    >
      <Group padded>
        <Segmented
          label="Entry type"
          value={kind}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
          onChange={(k) => {
            setKind(k);
            setCategoryUid(undefined);
          }}
        />
        <label className="visually-hidden" htmlFor="rule-amount">
          Amount in {currency}
        </label>
        <input
          id="rule-amount"
          className="input amount num"
          inputMode="decimal"
          placeholder="Amount"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
        />
      </Group>
      <Group>
        <div className="row">
          <label className="visually-hidden" htmlFor="rule-title">
            Title
          </label>
          <input
            id="rule-title"
            className="input left"
            placeholder="Rent, salary, Netflix…"
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <Field label="Category">
          <MenuButton
            label="Category"
            options={[
              { id: "", label: "None", selected: !categoryUid },
              ...choices.map((c) => ({
                id: c.uid,
                label: c.name,
                selected: c.uid === categoryUid,
              })),
            ]}
            onAction={(id) => setCategoryUid(id || undefined)}
          >
            {categoryUid ? categoryByUid.get(categoryUid)?.name : "None"}
          </MenuButton>
        </Field>
        <Field label={kind === "income" ? "Received Via" : "Paid With"}>
          <MenuButton
            label="Payment method"
            options={[
              { id: "", label: "None", selected: !methodUid },
              ...paymentMethods.map((m) => ({
                id: m.uid,
                label: m.name,
                selected: m.uid === methodUid,
              })),
            ]}
            onAction={(id) => setMethodUid(id || undefined)}
          >
            {methodUid ? methodByUid.get(methodUid)?.name : "None"}
          </MenuButton>
        </Field>
      </Group>
      <Group footer="Changing the schedule restarts it from the start date. Entries already added stay.">
        <Field label="Repeats">
          <MenuButton
            label="Repeats"
            options={(Object.keys(cadenceLabel) as Cadence[]).map((c) => ({
              id: c,
              label: cadenceLabel[c],
              selected: c === cadence,
            }))}
            onAction={(id) => setCadence(id as Cadence)}
          >
            {cadenceLabel[cadence]}
          </MenuButton>
        </Field>
        <Field label="Starts" htmlFor="rule-start">
          <input
            id="rule-start"
            className="input"
            type="date"
            value={startOn}
            onChange={(e) => e.target.value && setStartOn(e.target.value)}
          />
        </Field>
        {rule && <Toggle label="Paused" isSelected={paused} onChange={setPaused} />}
      </Group>
      {rule && (
        <Group footer="Entries already added stay in Activity.">
          <Row
            onPress={() => run([remove("recurringRules", rule.uid)])}
            title={<span style={{ color: "var(--red)" }}>Delete Repeating Entry</span>}
          />
        </Group>
      )}
    </Sheet>
  );
}
