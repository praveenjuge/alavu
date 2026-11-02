import { useState } from "react";
import { Button } from "react-aria-components";
import { ChevronDown, ChevronUp, Plus } from "vadivam-react";
import { spaceSymbols, tints } from "../components/icons";
import {
  Badge,
  errorMessage,
  Field,
  Group,
  PageHeader,
  Row,
  Sheet,
  Toggle,
  useToast,
} from "../components/ui";
import { type Space, useApp } from "../data";
import { newUid, remove, upsert } from "../lib/changes";
import { SymbolGrid } from "./Settings";
import { CurrencySelect, MonthStartSelect } from "./Setup";

function spaceData(s: Space) {
  return {
    name: s.name,
    symbol: s.symbol,
    tint: s.tint,
    currency: s.currency,
    monthStartDay: s.monthStartDay,
    sortOrder: s.sortOrder,
    archivedAt: s.archivedAt,
  };
}

export function Spaces() {
  const { spaces, push, online } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<{ space?: Space } | null>(null);
  const live = spaces.filter((s) => s.archivedAt === undefined);
  const archived = spaces.filter((s) => s.archivedAt !== undefined);

  async function move(index: number, by: -1 | 1) {
    const order = [...live];
    const [item] = order.splice(index, 1);
    order.splice(index + by, 0, item);
    try {
      await push(
        order
          .map((s, i) => ({ s, i }))
          .filter(({ s, i }) => s.sortOrder !== i)
          .map(({ s, i }) => upsert("spaces", s.uid, { ...spaceData(s), sortOrder: i })),
      );
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  const row = (s: Space, index?: number) => (
    <div key={s.uid} style={{ display: "flex", alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Row
          onPress={() => setEditing({ space: s })}
          icon={<Badge symbol={s.symbol} tint={tints[s.tint]} />}
          title={s.name}
          subtitle={s.currency}
        />
      </div>
      {index !== undefined && (
        <span style={{ display: "flex", paddingRight: 8 }}>
          <Button
            className="button plain icon"
            aria-label={`Move ${s.name} up`}
            isDisabled={!online || index === 0}
            onPress={() => move(index, -1)}
          >
            <ChevronUp size={18} aria-hidden />
          </Button>
          <Button
            className="button plain icon"
            aria-label={`Move ${s.name} down`}
            isDisabled={!online || index === live.length - 1}
            onPress={() => move(index, 1)}
          >
            <ChevronDown size={18} aria-hidden />
          </Button>
        </span>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Spaces">
        <Button className="button" isDisabled={!online} onPress={() => setEditing({})}>
          <Plus size={16} aria-hidden /> New Space
        </Button>
      </PageHeader>
      <Group footer="Keep separate money apart, like Personal, Office, or a church fund. Each space has its own currency, categories, and budgets.">
        {live.map((s, i) => row(s, i))}
      </Group>
      {archived.length > 0 && <Group header="Archived">{archived.map((s) => row(s))}</Group>}
      {editing && <SpaceEditor space={editing.space} onClose={() => setEditing(null)} />}
    </>
  );
}

export function SpaceEditor({ space, onClose }: { space?: Space; onClose: () => void }) {
  const { spaces, space: current, push, online, selectSpace } = useApp();
  const toast = useToast();
  const [name, setName] = useState(space?.name ?? "");
  const [symbol, setSymbol] = useState(space?.symbol ?? "briefcase");
  const [tint, setTint] = useState(space?.tint ?? "blue");
  const [currency, setCurrency] = useState(space?.currency ?? current.currency);
  const [monthStartDay, setMonthStartDay] = useState(space?.monthStartDay ?? 1);
  const [archived, setArchived] = useState(space?.archivedAt !== undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    const uid = space?.uid ?? newUid();
    try {
      await push([
        upsert("spaces", uid, {
          name: name.trim(),
          symbol,
          tint,
          currency,
          monthStartDay,
          sortOrder: space?.sortOrder ?? spaces.length,
          archivedAt: archived ? (space?.archivedAt ?? Date.now()) : undefined,
        }),
      ]);
      if (!space) selectSpace(uid);
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  async function destroy() {
    if (!space) return;
    try {
      await push([remove("spaces", space.uid)]);
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title={space ? "Edit Space" : "New Space"}
      action={
        <Button className="button primary" isDisabled={!online || !name.trim()} onPress={save}>
          Save
        </Button>
      }
    >
      <Group
        footer={
          space
            ? "Budgets reset on this day each month, so they can follow your payday."
            : "Each space has its own currency, categories, and budgets."
        }
      >
        <Field label="Name" htmlFor="space-name">
          <input
            id="space-name"
            className="input"
            autoFocus
            maxLength={500}
            placeholder="Office"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <CurrencySelect value={currency} onChange={setCurrency} disabled={!!space} />
        <MonthStartSelect value={monthStartDay} onChange={setMonthStartDay} />
      </Group>
      <Group header="Color">
        <div className="symbol-grid">
          {Object.entries(tints).map(([key, color]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              aria-pressed={key === tint}
              onClick={() => setTint(key)}
            >
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: color }} />
            </button>
          ))}
        </div>
      </Group>
      <Group header="Icon">
        <SymbolGrid symbols={spaceSymbols} value={symbol} onChange={setSymbol} />
      </Group>
      {space && !space.isDefault && (
        <Group footer="Archived spaces are hidden from the switcher but keep their entries.">
          <Toggle label="Archived" isSelected={archived} onChange={setArchived} />
          {confirmDelete ? (
            <Row
              onPress={destroy}
              title={<span style={{ color: "var(--red)" }}>Delete Space and Entries</span>}
              subtitle="Every entry, budget, and receipt in this space will be deleted."
            />
          ) : (
            <Row
              onPress={() => setConfirmDelete(true)}
              title={<span style={{ color: "var(--red)" }}>Delete Space</span>}
            />
          )}
        </Group>
      )}
    </Sheet>
  );
}
