import { type ReactNode, useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { NavLink, Outlet, useNavigate } from "react-router";
import { ChartColumn, ChevronDown, Gauge, List, Plus, Settings } from "vadivam-react";
import { useApp } from "../data";
import { SpaceEditor } from "../views/Spaces";
import { EntryEditorProvider, useEntryEditor } from "./entry";
import { SymbolIcon, tints } from "./icons";
import { MenuButton } from "./ui";

const tabs = [
  { to: "/", label: "Overview", icon: ChartColumn, key: "1" },
  { to: "/activity", label: "Activity", icon: List, key: "2" },
  { to: "/budgets", label: "Budgets", icon: Gauge, key: "3" },
  { to: "/settings", label: "Settings", icon: Settings, key: "4" },
];

export function Shell() {
  return (
    <EntryEditorProvider>
      <Layout />
    </EntryEditorProvider>
  );
}

function Layout() {
  const { online } = useApp();
  return (
    <>
      {!online && (
        <div className="banner" role="status">
          You're offline. Changes are paused until you reconnect.
        </div>
      )}
      <div className="shell">
        <aside className="sidebar" aria-label="Alavu">
          <SpaceMenu />
          <nav>
            {tabs.map(({ to, label, icon: Icon, key }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                <Icon size={18} aria-hidden />
                {label}
                <kbd>{key}</kbd>
              </NavLink>
            ))}
          </nav>
          <AddButton wide />
          <SidebarFooter />
        </aside>
        <main className="main">
          <div className="mobile-bar">
            <SpaceMenu />
            <AddButton />
          </div>
          <div className="content">
            <Outlet />
          </div>
        </main>
        <nav className="tab-bar" aria-label="Sections">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={22} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Shortcuts />
    </>
  );
}

function AddButton({ wide }: { wide?: boolean }) {
  const { open } = useEntryEditor();
  const { online } = useApp();
  if (wide) {
    return (
      <Button className="button primary" isDisabled={!online} onPress={() => open()}>
        <Plus size={18} aria-hidden /> New Entry
      </Button>
    );
  }
  return (
    <Button
      aria-label="New entry"
      className="button round-add"
      isDisabled={!online}
      onPress={() => open()}
    >
      <Plus size={22} aria-hidden />
    </Button>
  );
}

function SpaceMenu() {
  const { spaces, space, selectSpace } = useApp();
  const [creating, setCreating] = useState(false);
  const live = spaces.filter((s) => s.archivedAt === undefined);
  return (
    <>
      <MenuButton
        label="Switch space"
        className="button plain space-switcher"
        options={[
          ...live.map((s) => ({
            id: s.uid,
            label: s.name,
            selected: s.uid === space.uid,
            icon: (
              <span style={{ color: tints[s.tint] ?? tints.green, display: "flex" }}>
                <SymbolIcon name={s.symbol} />
              </span>
            ),
          })),
          { id: "__new", label: "New Space…", separatorBefore: true },
        ]}
        onAction={(id) => (id === "__new" ? setCreating(true) : selectSpace(id))}
      >
        <span style={{ color: tints[space.tint] ?? tints.green, display: "flex" }}>
          <SymbolIcon name={space.symbol} size={20} />
        </span>
        <span style={{ color: "var(--label)", fontWeight: 600, fontSize: 17 }}>{space.name}</span>
        <ChevronDown size={16} aria-hidden style={{ color: "var(--secondary)" }} />
      </MenuButton>
      {creating && <SpaceEditor onClose={() => setCreating(false)} />}
    </>
  );
}

function SidebarFooter() {
  const { user } = useApp();
  return (
    <div className="sidebar-footer">
      <span className="muted" style={{ padding: "0 10px" }}>
        {user.email}
      </span>
    </div>
  );
}

const shortcutList: [string, string][] = [
  ["N", "New entry"],
  ["/", "Search entries"],
  ["1 – 4", "Overview, Activity, Budgets, Settings"],
  ["⌘ K", "Switch space"],
  ["?", "Show shortcuts"],
  ["Esc", "Close"],
];

export function ShortcutHelp({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <ModalOverlay
      className="overlay"
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      isDismissable
    >
      <Modal className="modal" style={{ width: "min(420px, 100%)" }}>
        <Dialog className="dialog">
          <div className="sheet-header">
            <span />
            <Heading slot="title">Keyboard Shortcuts</Heading>
            <Button className="button plain" onPress={onClose}>
              Done
            </Button>
          </div>
          <div className="sheet-body">
            <div className="card">
              {shortcutList.map(([key, label]) => (
                <div className="row" key={key}>
                  <span className="row-text">{label}</span>
                  <kbd className="key">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function Shortcuts() {
  const navigate = useNavigate();
  const { open } = useEntryEditor();
  const { online } = useApp();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector(".overlay")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const switcher = [...document.querySelectorAll<HTMLButtonElement>(".space-switcher")].find(
          (b) => b.offsetParent !== null,
        );
        switcher?.click();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const tab = tabs.find((t) => t.key === event.key);
      if (tab) {
        navigate(tab.to);
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        if (online) open();
      } else if (event.key === "/") {
        event.preventDefault();
        navigate("/activity", { state: { focusSearch: Date.now() } });
      } else if (event.key === "?") {
        setHelp(true);
      } else {
        return;
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [navigate, open, online]);

  return <ShortcutHelp isOpen={help} onClose={() => setHelp(false)} />;
}

export function Loading({ children }: { children?: ReactNode }) {
  return (
    <div className="center-screen muted" role="status">
      {children ?? "Loading…"}
    </div>
  );
}
