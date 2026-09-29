import type { ReactNode } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export function IconButton({
  title,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function MenuItem({
  children,
  shortcut,
  onSelect,
  disabled = false,
}: {
  children: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item
      className="menu-item"
      onSelect={onSelect}
      disabled={disabled}
    >
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </Dropdown.Item>
  );
}
export function Menu({
  trigger,
  children,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button className="menu-trigger" aria-label={label}>
          {trigger}
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu-content" sideOffset={8} align="start">
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export const Separator = () => <Dropdown.Separator className="separator" />;
export function Modal({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label="Закрыть">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ColorField({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="color-field">
        <input
          type="color"
          aria-label={label}
          value={value === "none" ? "#FFFFFF" : value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="color-value">
          {value === "none" ? "Нет заливки" : value.toUpperCase()}
        </span>
        {allowNone && (
          <button
            className={`no-fill ${value === "none" ? "active" : ""}`}
            aria-label="Без заливки"
            title="Без заливки"
            onClick={() => onChange("none")}
          >
            ∅
          </button>
        )}
      </div>
    </div>
  );
}
export function Logo() {
  return (
    <svg
      width="28"
      height="30"
      viewBox="0 0 28 30"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 25L13.8 4L25 25M8 17H19"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M14 22V28" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}
