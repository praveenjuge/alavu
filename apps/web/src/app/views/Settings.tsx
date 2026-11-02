import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { CreditCard, Keyboard, Layers, LogOut, Plus, Repeat, Tag, Trash } from "vadivam-react";
import { signOut } from "../auth";
import { categorySymbols, SymbolIcon } from "../components/icons";
import { ShortcutHelp } from "../components/Shell";
import {
  Badge,
  errorMessage,
  Field,
  Group,
  PageHeader,
  Row,
  Segmented,
  Sheet,
  Toggle,
  useToast,
} from "../components/ui";
import { type Category, type PaymentMethod, useApp } from "../data";
import { analyticsOptedOut, setAnalyticsOptOut } from "../lib/analytics";
import { newUid, remove, upsert } from "../lib/changes";

const linkIcon = (Icon: typeof Tag) => (
  <span className="badge">
    <Icon size={18} aria-hidden />
  </span>
);

export function Settings() {
  const { space, user } = useApp();
  const [optedOut, setOptedOut] = useState(analyticsOptedOut);
  const [confirm, setConfirm] = useState<"signout" | "delete" | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <>
      <PageHeader title="Settings" />
      <Group>
        <Row to="/settings/spaces" icon={linkIcon(Layers)} title="Spaces" />
      </Group>
      <Group header={space.name}>
        <Row to="/settings/categories" icon={linkIcon(Tag)} title="Categories" />
        <Row to="/settings/repeating" icon={linkIcon(Repeat)} title="Repeating Entries" />
      </Group>
      <Group>
        <Row to="/settings/payment-methods" icon={linkIcon(CreditCard)} title="Payment Methods" />
      </Group>
      <div className="desktop-only">
        <Group>
          <Row
            onPress={() => setShortcuts(true)}
            icon={linkIcon(Keyboard)}
            title="Keyboard Shortcuts"
            trailing={<kbd className="key">?</kbd>}
          />
        </Group>
      </div>
      <Group
        header="Data"
        footer="Usage data and crash reports help fix problems. They never include amounts, names, or notes."
      >
        <Toggle
          label="Share Anonymous Usage Data"
          isSelected={!optedOut}
          onChange={(on) => {
            setAnalyticsOptOut(!on);
            setOptedOut(!on);
          }}
        />
      </Group>
      <Group header="Account">
        <Row title="Signed In As" trailing={user.email} />
        <Row
          onPress={() => setConfirm("signout")}
          title={<span style={{ color: "var(--red)" }}>Sign Out</span>}
        />
        <Row
          onPress={() => setConfirm("delete")}
          title={<span style={{ color: "var(--red)" }}>Delete Account</span>}
        />
      </Group>
      <Group>
        <Row title="Privacy Policy" href="/privacy/" />
        <Row title="Terms" href="/terms/" />
        <Row title="Support" href="/support/" />
      </Group>
      <ShortcutHelp isOpen={shortcuts} onClose={() => setShortcuts(false)} />
      {confirm === "signout" && <SignOutSheet onClose={() => setConfirm(null)} />}
      {confirm === "delete" && <DeleteAccountSheet onClose={() => setConfirm(null)} />}
    </>
  );
}

function SignOutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet isOpen onClose={onClose} title="Sign Out?">
      <Group footer="Your data stays in your account and comes back when you sign in again.">
        <Row
          onPress={() => void signOut()}
          icon={linkIcon(LogOut)}
          title={<span style={{ color: "var(--red)" }}>Sign Out</span>}
        />
      </Group>
    </Sheet>
  );
}

function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const deleteAccount = useAction(api.account.deleteAccount);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await deleteAccount({});
      await signOut();
    } catch (error) {
      toast(errorMessage(error));
      setBusy(false);
    }
  }
  return (
    <Sheet isOpen onClose={onClose} title="Delete Your Account?">
      <Group footer="This permanently deletes your account, every space, entry, budget, and receipt. It can't be undone.">
        <Row
          onPress={busy ? undefined : confirm}
          icon={
            <span className="badge" style={{ "--tint": "var(--red)" } as React.CSSProperties}>
              <Trash size={18} aria-hidden />
            </span>
          }
          title={
            <span style={{ color: "var(--red)" }}>
              {busy ? "Deleting…" : "Delete Account and Data"}
            </span>
          }
        />
      </Group>
    </Sheet>
  );
}

// MARK: Categories

export function Categories() {
  const { space, categories } = useApp();
  const [editing, setEditing] = useState<{
    category?: Category;
    kind: "expense" | "income";
  } | null>(null);
  const section = (kind: "expense" | "income") => (
    <Group header={kind === "expense" ? "Expenses" : "Income"}>
      {categories
        .filter((c) => c.kind === kind && c.archivedAt === undefined)
        .map((c) => (
          <Row
            key={c.uid}
            onPress={() => setEditing({ category: c, kind })}
            icon={<Badge symbol={c.symbol} />}
            title={c.name}
          />
        ))}
      <Row
        onPress={() => setEditing({ kind })}
        icon={
          <span className="badge">
            <Plus size={18} aria-hidden />
          </span>
        }
        title={<span style={{ color: "var(--accent)" }}>Add Category</span>}
      />
    </Group>
  );
  return (
    <>
      <PageHeader title="Categories" />
      <p className="muted" style={{ marginTop: -8 }}>
        For {space.name}
      </p>
      {section("expense")}
      {section("income")}
      {editing && <CategoryEditor {...editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategoryEditor({
  category,
  kind: initialKind,
  onClose,
}: {
  category?: Category;
  kind: "expense" | "income";
  onClose: () => void;
}) {
  const { space, categories, push, online } = useApp();
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? "");
  const [symbol, setSymbol] = useState(category?.symbol ?? "tag");
  const [kind, setKind] = useState(initialKind);

  async function run(changes: Parameters<typeof push>[0]) {
    try {
      await push(changes);
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  const save = () =>
    run([
      upsert("categories", category?.uid ?? newUid(), {
        spaceUid: space.uid,
        name: name.trim(),
        symbol,
        kind,
        sortOrder: category?.sortOrder ?? categories.length,
      }),
    ]);

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title={category ? "Edit Category" : "New Category"}
      action={
        <Button className="button primary" isDisabled={!online || !name.trim()} onPress={save}>
          Save
        </Button>
      }
    >
      <Group>
        <Field label="Name" htmlFor="category-name">
          <input
            id="category-name"
            className="input"
            autoFocus
            maxLength={500}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {!category && (
          <div className="row">
            <Segmented
              label="Category type"
              value={kind}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
              onChange={setKind}
            />
          </div>
        )}
      </Group>
      <Group header="Icon">
        <SymbolGrid symbols={categorySymbols} value={symbol} onChange={setSymbol} />
      </Group>
      {category && (
        <Group footer="Entries keep their history and show as uncategorized.">
          <Row
            onPress={() => run([remove("categories", category.uid)])}
            title={<span style={{ color: "var(--red)" }}>Delete Category</span>}
          />
        </Group>
      )}
    </Sheet>
  );
}

export function SymbolGrid({
  symbols,
  value,
  onChange,
}: {
  symbols: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="symbol-grid">
      {symbols.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={s}
          aria-pressed={s === value}
          onClick={() => onChange(s)}
        >
          <SymbolIcon name={s} size={20} />
        </button>
      ))}
    </div>
  );
}

// MARK: Payment methods

export function PaymentMethods() {
  const { paymentMethods } = useApp();
  const [editing, setEditing] = useState<{ method?: PaymentMethod } | null>(null);
  return (
    <>
      <PageHeader title="Payment Methods" />
      <Group footer="Labels for how you paid, shared by all your spaces.">
        {paymentMethods.map((m) => (
          <Row
            key={m.uid}
            onPress={() => setEditing({ method: m })}
            icon={<Badge symbol={m.symbol} />}
            title={m.name}
          />
        ))}
        <Row
          onPress={() => setEditing({})}
          icon={
            <span className="badge">
              <Plus size={18} aria-hidden />
            </span>
          }
          title={<span style={{ color: "var(--accent)" }}>Add Payment Method</span>}
        />
      </Group>
      {editing && <MethodEditor method={editing.method} onClose={() => setEditing(null)} />}
    </>
  );
}

const methodSymbols = [
  "banknote",
  "creditcard",
  "building.columns",
  "qrcode",
  "phone",
  "briefcase",
  "gift",
  "star",
];

function MethodEditor({ method, onClose }: { method?: PaymentMethod; onClose: () => void }) {
  const { paymentMethods, push, online } = useApp();
  const toast = useToast();
  const [name, setName] = useState(method?.name ?? "");
  const [symbol, setSymbol] = useState(method?.symbol ?? "creditcard");
  async function run(changes: Parameters<typeof push>[0]) {
    try {
      await push(changes);
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  return (
    <Sheet
      isOpen
      onClose={onClose}
      title={method ? "Edit Payment Method" : "New Payment Method"}
      action={
        <Button
          className="button primary"
          isDisabled={!online || !name.trim()}
          onPress={() =>
            run([
              upsert("paymentMethods", method?.uid ?? newUid(), {
                name: name.trim(),
                symbol,
                sortOrder: method?.sortOrder ?? paymentMethods.length,
              }),
            ])
          }
        >
          Save
        </Button>
      }
    >
      <Group>
        <Field label="Name" htmlFor="method-name">
          <input
            id="method-name"
            className="input"
            autoFocus
            maxLength={500}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </Group>
      <Group header="Icon">
        <SymbolGrid symbols={methodSymbols} value={symbol} onChange={setSymbol} />
      </Group>
      {method && (
        <Group>
          <Row
            onPress={() => run([remove("paymentMethods", method.uid)])}
            title={<span style={{ color: "var(--red)" }}>Delete Payment Method</span>}
          />
        </Group>
      )}
    </Sheet>
  );
}
