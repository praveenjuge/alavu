import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Separator,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import { Link } from "react-router";
import { Check, ChevronRight } from "vadivam-react";
import { formatMoney } from "../lib/money";
import type { BudgetStatus } from "../lib/summary";
import { SymbolIcon } from "./icons";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function Group({
  header,
  trailing,
  footer,
  children,
  padded,
}: {
  header?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="group">
      {header && (
        <h2 className="group-header">
          <span>{header}</span>
          {trailing && <span className="num">{trailing}</span>}
        </h2>
      )}
      <div className={padded ? "card card-pad" : "card"}>{children}</div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}

export function Badge({ symbol, tint }: { symbol: string; tint?: string }) {
  return (
    <span className="badge" style={tint ? ({ "--tint": tint } as React.CSSProperties) : undefined}>
      <SymbolIcon name={symbol} />
    </span>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
}

function RowContent({ icon, title, subtitle, trailing, chevron }: RowProps) {
  return (
    <>
      {icon}
      <span className="row-text">
        <span className="row-title">{title}</span>
        {subtitle && <span className="row-subtitle">{subtitle}</span>}
      </span>
      {(trailing || chevron) && (
        <span className="row-trailing">
          {trailing}
          {chevron && <ChevronRight size={16} aria-hidden />}
        </span>
      )}
    </>
  );
}

export function Row(
  props: RowProps & { onPress?: () => void; to?: string; href?: string; className?: string },
) {
  const className = `row${props.icon ? " with-icon" : ""} ${props.className ?? ""}`;
  if (props.href) {
    return (
      <a className={className} href={props.href}>
        <RowContent {...props} chevron={props.chevron ?? true} />
      </a>
    );
  }
  if (props.to) {
    return (
      <Link className={className} to={props.to}>
        <RowContent {...props} chevron={props.chevron ?? true} />
      </Link>
    );
  }
  if (props.onPress) {
    return (
      <Button className={className} onPress={props.onPress}>
        <RowContent {...props} />
      </Button>
    );
  }
  return (
    <div className={className}>
      <RowContent {...props} />
    </div>
  );
}

/** A label on the left and a control on the right, like an iOS form row. */
export function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="row">
      <label className="row-text" htmlFor={htmlFor}>
        {label}
      </label>
      <span style={{ flex: 1.4, display: "flex", justifyContent: "flex-end" }}>{children}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      className="segmented"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = [...keys];
        if (next) onChange(next as T);
      }}
    >
      {options.map((o) => (
        <ToggleButton key={o.value} id={o.value}>
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export function Toggle({
  label,
  isSelected,
  onChange,
}: {
  label: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="row">
      <Switch className="switch" isSelected={isSelected} onChange={onChange}>
        <span className="row-text">{label}</span>
        <span className="track" />
      </Switch>
    </div>
  );
}

export interface MenuOption {
  id: string;
  label: string;
  icon?: ReactNode;
  selected?: boolean;
  separatorBefore?: boolean;
}

/** A button that opens a native-feeling menu of options. */
export function MenuButton({
  label,
  children,
  options,
  onAction,
  className = "button plain",
  isDisabled,
}: {
  label: string;
  children: ReactNode;
  options: MenuOption[];
  onAction: (id: string) => void;
  className?: string;
  isDisabled?: boolean;
}) {
  return (
    <MenuTrigger>
      <Button aria-label={label} className={className} isDisabled={isDisabled}>
        {children}
      </Button>
      <Popover className="popover" placement="bottom end">
        <Menu className="menu" onAction={(key) => onAction(String(key))}>
          {options.flatMap((o) => [
            ...(o.separatorBefore
              ? [<Separator key={`${o.id}-sep`} className="menu-separator" />]
              : []),
            <MenuItem key={o.id} id={o.id} className="menu-item" textValue={o.label}>
              <span className="check">{o.selected && <Check size={16} aria-hidden />}</span>
              {o.icon}
              <span>{o.label}</span>
            </MenuItem>,
          ])}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** A modal sheet with Cancel, a title, and a primary action, like iOS. */
export function Sheet({
  isOpen,
  onClose,
  title,
  action,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      className="overlay"
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable
    >
      <Modal className="modal">
        <Dialog className="dialog">
          <div className="sheet-header">
            <span>
              <Button className="button plain" onPress={onClose}>
                Cancel
              </Button>
            </span>
            <Heading slot="title">{title}</Heading>
            <span>{action}</span>
          </div>
          <div className="sheet-body">{children}</div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function BudgetBar({ status }: { status: BudgetStatus }) {
  const width = `${Math.min(status.fraction, 1) * 100}%`;
  return (
    <div className={`progress ${status.level}`} role="presentation">
      <span style={{ width }} />
    </div>
  );
}

export function statusLabel(status: BudgetStatus) {
  return status.level === "over"
    ? "Over budget"
    : status.level === "approaching"
      ? "Near limit"
      : "On track";
}

export function leftLabel(status: BudgetStatus, currency: string) {
  return status.remaining >= 0n
    ? `${formatMoney(status.remaining, currency)} left of ${formatMoney(status.limit, currency)}`
    : `${formatMoney(-status.remaining, currency)} over ${formatMoney(status.limit, currency)}`;
}

// MARK: Toasts

const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);
  const show = useCallback((m: string) => setMessage(m), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function errorMessage(error: unknown) {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return "Something went wrong. Please try again.";
}
