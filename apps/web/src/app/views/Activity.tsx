import { api } from "@convex/_generated/api";
import { usePaginatedQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { ListFilter, Search } from "vadivam-react";
import { EntryRow, useEntryEditor } from "../components/entry";
import { Group, MenuButton, PageHeader } from "../components/ui";
import { useApp } from "../data";
import { formatMoney } from "../lib/money";
import { dayTitle } from "../lib/period";
import type { Entry } from "../lib/summary";

type KindFilter = "all" | "expense" | "income" | "transfer";

export function Activity() {
  const { space, categories, categoryByUid } = useApp();
  const { open } = useEntryEditor();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [categoryUid, setCategoryUid] = useState<string | null>(null);
  const { results, status, loadMore } = usePaginatedQuery(
    api.reads.entriesPage,
    { spaceUid: space.uid },
    { initialNumItems: 60 },
  );

  // "/" anywhere opens Activity with the search field focused.
  useEffect(() => {
    if ((location.state as { focusSearch?: number } | null)?.focusSearch)
      searchRef.current?.focus();
  }, [location.state]);

  // Load the next page when the end of the list scrolls into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || status !== "CanLoadMore") return;
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(100), {
      rootMargin: "400px",
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [status, loadMore]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return results.filter((e) => {
      if (kind === "transfer" && e.kind !== "transferIn" && e.kind !== "transferOut") return false;
      if ((kind === "expense" || kind === "income") && e.kind !== kind) return false;
      if (categoryUid && e.categoryUid !== categoryUid) return false;
      if (!needle) return true;
      const category = e.categoryUid ? categoryByUid.get(e.categoryUid)?.name : "";
      return [e.title, e.note, category].some((t) => t?.toLowerCase().includes(needle));
    });
  }, [results, query, kind, categoryUid, categoryByUid]);

  const days = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const e of filtered) groups.set(e.occurredOn, [...(groups.get(e.occurredOn) ?? []), e]);
    return [...groups];
  }, [filtered]);

  const filtering = kind !== "all" || categoryUid !== null;

  return (
    <>
      <PageHeader title="Activity">
        <MenuButton
          label="Filter entries"
          className={`button icon${filtering ? " primary" : ""}`}
          options={[
            { id: "kind:all", label: "All Entries", selected: kind === "all" },
            { id: "kind:expense", label: "Expenses", selected: kind === "expense" },
            { id: "kind:income", label: "Income", selected: kind === "income" },
            { id: "kind:transfer", label: "Transfers", selected: kind === "transfer" },
            {
              id: "cat:",
              label: "Any Category",
              selected: categoryUid === null,
              separatorBefore: true,
            },
            ...categories.map((c) => ({
              id: `cat:${c.uid}`,
              label: c.name,
              selected: c.uid === categoryUid,
            })),
          ]}
          onAction={(id) => {
            const [type, value] = id.split(":");
            if (type === "kind") setKind(value as KindFilter);
            else setCategoryUid(value || null);
          }}
        >
          <ListFilter size={18} aria-hidden />
        </MenuButton>
      </PageHeader>

      <label className="search">
        <Search size={16} aria-hidden />
        <span className="visually-hidden">Search entries</span>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search entries"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
        />
      </label>

      {status === "LoadingFirstPage" ? (
        <p className="empty">Loading…</p>
      ) : days.length === 0 ? (
        <p className="empty">
          {results.length === 0 ? "No entries yet. Press N to add one." : "No entries match."}
        </p>
      ) : (
        days.map(([day, entries]) => {
          const spent = entries.reduce(
            (sum, e) => (e.kind === "expense" ? sum + e.amountMinor : sum),
            0n,
          );
          return (
            <Group
              key={day}
              header={dayTitle(day)}
              trailing={spent > 0n ? formatMoney(spent, space.currency) : undefined}
            >
              {entries.map((e) => (
                <EntryRow key={e._id} entry={e} onPress={() => open(e)} />
              ))}
            </Group>
          );
        })
      )}
      <div ref={sentinel} />
      {status === "LoadingMore" && <p className="empty">Loading more…</p>}
    </>
  );
}
