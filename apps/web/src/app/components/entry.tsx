import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "react-aria-components";
import { Paperclip, Repeat, Trash, X } from "vadivam-react";
import { useApp } from "../data";
import { type Change, newUid, occurrenceUid, remove, transfer, upsert } from "../lib/changes";
import { amountInputValue, formatMoney, parseAmount } from "../lib/money";
import { today } from "../lib/period";
import { type Entry, signedAmount } from "../lib/summary";
import { tints } from "./icons";
import {
  Badge,
  errorMessage,
  Field,
  Group,
  MenuButton,
  Row,
  Segmented,
  Sheet,
  useToast,
} from "./ui";

// MARK: Rows

export function EntryRow({ entry, onPress }: { entry: Entry; onPress?: () => void }) {
  const { categoryByUid, methodByUid } = useApp();
  const category = entry.categoryUid ? categoryByUid.get(entry.categoryUid) : undefined;
  const method = entry.paymentMethodUid ? methodByUid.get(entry.paymentMethodUid) : undefined;
  const isTransfer = entry.kind === "transferIn" || entry.kind === "transferOut";
  const moneyIn = entry.kind === "income" || entry.kind === "transferIn";
  const symbol =
    entry.kind === "transferIn"
      ? "arrow.down.left"
      : entry.kind === "transferOut"
        ? "arrow.up.right"
        : (category?.symbol ?? (entry.kind === "income" ? "plus.circle" : "tag"));
  const title =
    entry.kind === "transferOut"
      ? `To ${entry.title}`
      : entry.kind === "transferIn"
        ? `From ${entry.title}`
        : entry.title;
  const subtitle = [isTransfer ? "Transfer" : (category?.name ?? "Uncategorized"), method?.name]
    .filter(Boolean)
    .join(" · ");
  return (
    <Row
      onPress={onPress}
      icon={<Badge symbol={symbol} tint={moneyIn ? tints.green : undefined} />}
      title={
        <>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          {entry.recurringRuleUid && <Repeat size={14} className="muted" aria-label="Repeats" />}
          {entry.receiptKeys.length > 0 && (
            <Paperclip size={14} className="muted" aria-label="Has receipt" />
          )}
        </>
      }
      subtitle={subtitle}
      trailing={
        <span
          className={`num ${moneyIn ? "amount-in" : ""}`}
          style={{ color: moneyIn ? undefined : "var(--label)" }}
        >
          {formatMoney(signedAmount(entry), entry.currency, { sign: moneyIn })}
        </span>
      }
    />
  );
}

// MARK: Editor state

const EditorContext = createContext<{ open: (entry?: Entry) => void }>({ open: () => undefined });
export const useEntryEditor = () => useContext(EditorContext);

export function EntryEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ entry?: Entry; key: number } | null>(null);
  const open = useCallback((entry?: Entry) => setState({ entry, key: Date.now() }), []);
  return (
    <EditorContext.Provider value={{ open }}>
      {children}
      {state && <EntryEditor key={state.key} entry={state.entry} onClose={() => setState(null)} />}
    </EditorContext.Provider>
  );
}

type Kind = "expense" | "income" | "transfer";
type Cadence = "never" | "weekly" | "monthly" | "yearly";

// MARK: Editor

function EntryEditor({ entry, onClose }: { entry?: Entry; onClose: () => void }) {
  const app = useApp();
  const toast = useToast();
  const space = entry ? (app.spaces.find((s) => s.uid === entry.spaceUid) ?? app.space) : app.space;
  const isTransferEdit = entry?.kind === "transferIn" || entry?.kind === "transferOut";
  const otherSpaces = app.spaces.filter((s) => s.uid !== space.uid && s.archivedAt === undefined);

  const [kind, setKind] = useState<Kind>(
    isTransferEdit ? "transfer" : entry?.kind === "income" ? "income" : "expense",
  );
  const [amount, setAmount] = useState(
    entry ? amountInputValue(entry.amountMinor, entry.currency) : "",
  );
  const [received, setReceived] = useState("");
  const [title, setTitle] = useState(isTransferEdit ? "" : (entry?.title ?? ""));
  const [categoryUid, setCategoryUid] = useState(entry?.categoryUid);
  const [methodUid, setMethodUid] = useState(entry?.paymentMethodUid);
  const [day, setDay] = useState(entry?.occurredOn ?? today());
  const [note, setNote] = useState(entry?.note ?? "");
  const [cadence, setCadence] = useState<Cadence>("never");
  const [targetUid, setTargetUid] = useState(otherSpaces[0]?.uid);
  const [receipts, setReceipts] = useState<string[]>(entry?.receiptKeys ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const legs = useQuery(
    api.reads.transferLegs,
    isTransferEdit && entry?.transferUid ? { transferUid: entry.transferUid } : "skip",
  );
  const target = app.spaces.find((s) => s.uid === targetUid);
  const amountMinor = parseAmount(amount, space.currency);
  const needsReceived =
    kind === "transfer" && !entry && !!target && target.currency !== space.currency;
  const receivedMinor = needsReceived ? parseAmount(received, target.currency) : amountMinor;
  const categories = app.categories.filter(
    (c) =>
      c.kind === (kind === "income" ? "income" : "expense") &&
      (c.archivedAt === undefined || c.uid === categoryUid),
  );
  const category = categoryUid ? app.categoryByUid.get(categoryUid) : undefined;
  const method = methodUid ? app.methodByUid.get(methodUid) : undefined;
  const canSave =
    app.online &&
    !saving &&
    !uploading &&
    !!amountMinor &&
    amountMinor > 0n &&
    (kind !== "transfer" || !!entry || (!!target && !!receivedMinor && receivedMinor > 0n));

  useEffect(() => amountRef.current?.focus(), []);

  const resolvedTitle = () =>
    title.trim() || category?.name || (kind === "income" ? "Income" : "Expense");

  async function save() {
    if (!canSave || !amountMinor) return;
    setSaving(true);
    const cleanNote = note.trim() || undefined;
    try {
      let changes: Change[];
      if (kind === "transfer" && entry && legs) {
        // Editing a transfer updates the date, note and this side's amount on both legs.
        const sameCurrency = legs.every((l) => l.currency === entry.currency);
        changes = legs.map((leg) =>
          upsert("transactions", leg.uid, {
            ...entryData(leg),
            amountMinor: leg.uid === entry.uid || sameCurrency ? amountMinor : leg.amountMinor,
            occurredOn: day,
            note: cleanNote,
          }),
        );
      } else if (kind === "transfer" && target && receivedMinor) {
        changes = transfer({
          from: space,
          to: target,
          sent: amountMinor,
          received: receivedMinor,
          day,
          note: cleanNote,
        });
      } else {
        const data = {
          spaceUid: space.uid,
          kind: kind === "income" ? ("income" as const) : ("expense" as const),
          amountMinor,
          currency: space.currency,
          title: resolvedTitle(),
          note: cleanNote,
          categoryUid,
          paymentMethodUid: methodUid,
          occurredOn: day,
          receiptKeys: receipts,
          recurringRuleUid: entry?.recurringRuleUid,
        };
        if (entry) {
          changes = [upsert("transactions", entry.uid, data)];
        } else if (cadence !== "never") {
          // The first occurrence uses the id the server gives it, so it isn't logged twice.
          const ruleUid = newUid();
          const { receiptKeys: _, recurringRuleUid: __, occurredOn: ___, ...rule } = data;
          changes = [
            upsert("recurringRules", ruleUid, { ...rule, cadence, interval: 1, startOn: day }),
            upsert("transactions", occurrenceUid(ruleUid, day), {
              ...data,
              recurringRuleUid: ruleUid,
            }),
          ];
        } else {
          changes = [upsert("transactions", newUid(), data)];
        }
      }
      await app.push(changes);
      onClose();
    } catch (error) {
      toast(errorMessage(error));
      setSaving(false);
    }
  }

  async function destroy() {
    if (!entry) return;
    const uids = legs?.length ? legs.map((l) => l.uid) : [entry.uid];
    try {
      await app.push(uids.map((uid) => remove("transactions", uid)));
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  const kinds: { value: Kind; label: string }[] = isTransferEdit
    ? [{ value: "transfer", label: "Transfer" }]
    : [
        { value: "expense", label: "Expense" },
        { value: "income", label: "Income" },
        ...(!entry && otherSpaces.length
          ? [{ value: "transfer" as const, label: "Transfer" }]
          : []),
      ];

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title={entry ? "Edit Entry" : "New Entry"}
      action={
        <Button className="button primary" isDisabled={!canSave} onPress={save}>
          Save
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Group padded>
          {kinds.length > 1 && (
            <Segmented
              label="Entry type"
              value={kind}
              options={kinds}
              onChange={(k) => {
                setKind(k);
                setCategoryUid(undefined);
              }}
            />
          )}
          <label className="visually-hidden" htmlFor="amount">
            Amount in {space.currency}
          </label>
          <input
            id="amount"
            ref={amountRef}
            className="input amount num"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
          />
          <span className="muted" style={{ fontSize: 13 }}>
            {amountMinor ? formatMoney(amountMinor, space.currency) : space.currency}
          </span>
        </Group>

        {kind === "transfer" ? (
          <Group>
            {entry ? (
              <Row title={entry.kind === "transferOut" ? "To" : "From"} trailing={entry.title} />
            ) : (
              <Field label="To">
                <MenuButton
                  label="Destination space"
                  options={otherSpaces.map((s) => ({
                    id: s.uid,
                    label: s.name,
                    selected: s.uid === targetUid,
                  }))}
                  onAction={setTargetUid}
                >
                  {target?.name ?? "Choose"}
                </MenuButton>
              </Field>
            )}
            {needsReceived && target && (
              <Field label={`Received in ${target.currency}`} htmlFor="received">
                <input
                  id="received"
                  className="input num"
                  inputMode="decimal"
                  placeholder="Amount"
                  value={received}
                  onChange={(e) => setReceived(e.target.value.replace(/[^\d.,]/g, ""))}
                />
              </Field>
            )}
          </Group>
        ) : (
          <Group>
            <div className="row">
              <label className="visually-hidden" htmlFor="title">
                Title
              </label>
              <input
                id="title"
                className="input left"
                placeholder={kind === "income" ? "Where's it from?" : "What was it for?"}
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
                  ...categories.map((c) => ({
                    id: c.uid,
                    label: c.name,
                    selected: c.uid === categoryUid,
                  })),
                ]}
                onAction={(id) => setCategoryUid(id || undefined)}
              >
                {category?.name ?? "None"}
              </MenuButton>
            </Field>
            <Field label={kind === "income" ? "Received Via" : "Paid With"}>
              <MenuButton
                label={kind === "income" ? "Received via" : "Paid with"}
                options={[
                  { id: "", label: "None", selected: !methodUid },
                  ...app.paymentMethods.map((m) => ({
                    id: m.uid,
                    label: m.name,
                    selected: m.uid === methodUid,
                  })),
                ]}
                onAction={(id) => setMethodUid(id || undefined)}
              >
                {method?.name ?? "None"}
              </MenuButton>
            </Field>
          </Group>
        )}

        <Group>
          <Field label="Date" htmlFor="date">
            <input
              id="date"
              className="input"
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
          </Field>
          {!entry && kind !== "transfer" && (
            <Field label="Repeat">
              <MenuButton
                label="Repeat"
                options={(["never", "weekly", "monthly", "yearly"] as const).map((c) => ({
                  id: c,
                  label: c === "never" ? "Never" : c[0].toUpperCase() + c.slice(1),
                  selected: c === cadence,
                }))}
                onAction={(id) => setCadence(id as Cadence)}
              >
                {cadence === "never" ? "Never" : cadence[0].toUpperCase() + cadence.slice(1)}
              </MenuButton>
            </Field>
          )}
          <div className="row">
            <label className="visually-hidden" htmlFor="note">
              Note
            </label>
            <textarea
              id="note"
              className="input"
              placeholder="Note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </Group>

        {kind !== "transfer" && (
          <Receipts
            spaceUid={space.uid}
            keys={receipts}
            onChange={setReceipts}
            onUploading={setUploading}
          />
        )}

        {entry && (
          <Group>
            <Row
              onPress={destroy}
              className="button danger"
              icon={<Trash size={18} aria-hidden style={{ color: "var(--red)" }} />}
              title={
                <span style={{ color: "var(--red)" }}>
                  {isTransferEdit ? "Delete Transfer" : "Delete Entry"}
                </span>
              }
            />
          </Group>
        )}
      </form>
    </Sheet>
  );
}

function entryData(e: Entry) {
  return {
    spaceUid: e.spaceUid,
    kind: e.kind,
    amountMinor: e.amountMinor,
    currency: e.currency,
    title: e.title,
    note: e.note,
    categoryUid: e.categoryUid,
    paymentMethodUid: e.paymentMethodUid,
    occurredOn: e.occurredOn,
    transferUid: e.transferUid,
    recurringRuleUid: e.recurringRuleUid,
    receiptKeys: e.receiptKeys,
  };
}

// MARK: Receipts

/** Downscales a photo to at most 2048px and re-encodes it as JPEG, like the iOS app. */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't read that image"))),
      "image/jpeg",
      0.85,
    ),
  );
}

function Receipts({
  spaceUid,
  keys,
  onChange,
  onUploading,
}: {
  spaceUid: string;
  keys: string[];
  onChange: (keys: string[]) => void;
  onUploading: (busy: boolean) => void;
}) {
  const uploadUrl = useMutation(api.receipts.uploadUrl);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    onUploading(true);
    try {
      const added: string[] = [];
      for (const file of [...files].slice(0, 10 - keys.length)) {
        const jpeg = await toJpeg(file);
        const target = await uploadUrl({ spaceUid });
        const response = await fetch(target.url, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: jpeg,
        });
        if (!response.ok) throw new Error("Upload failed");
        added.push(target.key);
      }
      onChange([...keys, ...added]);
    } catch {
      toast("Couldn't add that receipt. Please try again.");
    } finally {
      onUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Group header="Receipts">
      {keys.length > 0 && (
        <div className="receipts">
          {keys.map((key) => (
            <ReceiptThumb
              key={key}
              receiptKey={key}
              onRemove={() => onChange(keys.filter((k) => k !== key))}
            />
          ))}
        </div>
      )}
      {keys.length < 10 && (
        <Row
          onPress={() => input.current?.click()}
          icon={
            <Paperclip size={18} aria-hidden style={{ color: "var(--accent)", margin: "0 7px" }} />
          }
          title={<span style={{ color: "var(--accent)" }}>Add Receipt</span>}
        />
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void add(e.target.files)}
      />
    </Group>
  );
}

function ReceiptThumb({ receiptKey, onRemove }: { receiptKey: string; onRemove: () => void }) {
  const downloadUrl = useMutation(api.receipts.downloadUrl);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    downloadUrl({ key: receiptKey })
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [receiptKey, downloadUrl]);
  return (
    <div className="receipt">
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="Receipt" />
        </a>
      )}
      <button type="button" aria-label="Remove receipt" onClick={onRemove}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
