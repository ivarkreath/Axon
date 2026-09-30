import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

export function returnEditorFocus() {
  const target =
    document.querySelector<HTMLTextAreaElement>(".canvas-text") ??
    document.querySelector<SVGSVGElement>(".canvas");
  target?.focus({ preventScroll: true });
}
type View = { label: string; content: ReactNode };
const PopoverContext = createContext<((view: View) => void) | null>(null);
const OPEN_EVENT = "axon-property-open";

/** One surface per panel; overflow pickers replace its contents instead of stacking. */
export function PropertyPopover({
  label,
  trigger,
  children,
  chevron = true,
  anchor,
  onClose,
}: {
  label: string;
  trigger?: ReactNode;
  children: ReactNode;
  chevron?: boolean;
  anchor?: { x: number; y: number };
  onClose?: () => void;
}) {
  const parent = useContext(PopoverContext);
  const id = useId();
  const [open, setOpen] = useState(!!anchor);
  const [view, setView] = useState<View | null>(null);
  const root = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const keyboard = useRef(!!anchor);
  const close = (focus = false) => {
    setOpen(false);
    setView(null);
    if (focus) button.current?.focus({ preventScroll: true });
    if (focus && anchor) returnEditorFocus();
    onClose?.();
  };
  useLayoutEffect(() => {
    if (!open || !root.current || !popup.current) return;
    const place = () => {
      const r = root.current!.getBoundingClientRect(),
        p = popup.current!;
      p.style.left = `${Math.max(12, Math.min(window.innerWidth - p.offsetWidth - 12, r.left))}px`;
      const below = r.bottom + 8;
      p.style.top = `${Math.max(12, Math.min(window.innerHeight - p.offsetHeight - 12, below + p.offsetHeight <= window.innerHeight - 12 ? below : r.top - p.offsetHeight - 8))}px`;
    };
    place();
    if (keyboard.current)
      (
        popup.current.querySelector(
          '[aria-pressed="true"], button, input, select',
        ) as HTMLElement | null
      )?.focus();
    const observer = new ResizeObserver(place);
    observer.observe(popup.current);
    observer.observe(root.current);
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== id) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close(true);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener(OPEN_EVENT, other);
    window.addEventListener("resize", place);
    document.addEventListener("keydown", escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener(OPEN_EVENT, other);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, view, id]);
  return (
    <div
      className="property-popover"
      ref={root}
      style={
        anchor
          ? {
              position: "fixed",
              left: anchor.x,
              top: anchor.y,
              width: 1,
              height: 1,
              zIndex: 50,
            }
          : undefined
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-close-popover]")) {
          close(keyboard.current);
          if (!keyboard.current) returnEditorFocus();
        }
      }}
    >
      {!anchor && (
        <button
          ref={button}
          className={`property-control ${chevron ? "with-chevron" : ""}`}
          data-tooltip={label}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onPointerDown={(e) => {
            e.preventDefault();
            keyboard.current = false;
          }}
          onClick={(e) => {
            keyboard.current = e.detail === 0;
            if (parent) {
              parent({ label, content: children });
              return;
            }
            if (open) close(true);
            else {
              window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
              setOpen(true);
            }
          }}
        >
          {trigger}
          {chevron && (
            <ChevronDown
              className="property-chevron"
              size={10}
              aria-hidden="true"
            />
          )}
        </button>
      )}
      {open && (
        <div
          ref={popup}
          id={id}
          className="property-popup panel"
          role="dialog"
          aria-label={view?.label ?? label}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <PopoverContext.Provider value={setView}>
            {view?.content ?? children}
          </PopoverContext.Provider>
        </div>
      )}
    </div>
  );
}
