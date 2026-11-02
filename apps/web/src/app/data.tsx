import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Change } from "./lib/changes";

export type Space = Doc<"spaces"> & { role: "owner" | "editor" | "viewer" };
export type Category = Doc<"categories">;
export type PaymentMethod = Doc<"paymentMethods">;
export type RecurringRule = Doc<"recurringRules">;

interface AppData {
  user: { name: string | null; email: string | null };
  spaces: Space[];
  space: Space;
  selectSpace: (uid: string) => void;
  categories: Category[];
  budgets: Doc<"budgets">[];
  recurringRules: RecurringRule[];
  paymentMethods: PaymentMethod[];
  categoryByUid: Map<string, Category>;
  methodByUid: Map<string, PaymentMethod>;
  online: boolean;
  push: (changes: Change[]) => Promise<void>;
}

const Context = createContext<AppData | null>(null);

export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("useApp outside AppDataProvider");
  return value;
}

const SELECTED = "alavu.selectedSpace";

function readSelected() {
  try {
    return localStorage.getItem(SELECTED);
  } catch {
    return null;
  }
}

/** Whether the browser and the Convex connection are both up; edits wait otherwise. */
export function useOnline() {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  const connection = useConvexConnectionState();
  // Give the socket a moment on first load before calling it offline.
  const connected = connection.isWebSocketConnected || !connection.hasEverConnected;
  return browserOnline && connected;
}

type Account = NonNullable<ReturnType<typeof useAccountQuery>>;
const useAccountQuery = () => useQuery(api.reads.account, {});

/**
 * Loads everything the signed-in screens need. Renders `fallback` until the account is
 * ready, and `setup` when the person hasn't finished first-run setup yet.
 */
export function AppDataProvider({
  children,
  loading,
  setup,
}: {
  children: ReactNode;
  loading: ReactNode;
  setup: ReactNode;
}) {
  const account = useAccountQuery();
  if (account === undefined) return loading;
  if (account.spaces.length === 0) return setup;
  return <Loaded account={account}>{children}</Loaded>;
}

function Loaded({ account, children }: { account: Account; children: ReactNode }) {
  const [selected, setSelected] = useState(readSelected);
  const live = account.spaces.filter((s) => s.archivedAt === undefined);
  const space =
    live.find((s) => s.uid === selected) ??
    live.find((s) => s.isDefault) ??
    live[0] ??
    account.spaces[0];

  const setupData = useQuery(api.reads.spaceSetup, { spaceUid: space.uid });
  const paymentMethods = useQuery(api.reads.paymentMethods, {});
  const pushMutation = useMutation(api.sync.push);
  const online = useOnline();

  const selectSpace = useCallback((uid: string) => {
    setSelected(uid);
    try {
      localStorage.setItem(SELECTED, uid);
    } catch {
      // Remembering the space is a convenience; private windows can't store it.
    }
  }, []);

  const push = useCallback(
    async (changes: Change[]) => {
      if (!changes.length) return;
      await pushMutation({ changes });
    },
    [pushMutation],
  );

  const value = useMemo<AppData | null>(() => {
    if (!setupData || !paymentMethods) return null;
    return {
      user: account.user,
      spaces: account.spaces,
      space,
      selectSpace,
      categories: setupData.categories,
      budgets: setupData.budgets,
      recurringRules: setupData.recurringRules,
      paymentMethods,
      categoryByUid: new Map(setupData.categories.map((c) => [c.uid, c])),
      methodByUid: new Map(paymentMethods.map((m) => [m.uid, m])),
      online,
      push,
    };
  }, [account, space, selectSpace, setupData, paymentMethods, online, push]);

  if (!value) return null;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
