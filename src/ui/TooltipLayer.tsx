import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
/** Viewport tooltip shared by icon controls, including keyboard focus. */
export function TooltipLayer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (e: Event) =>
      setTarget((e.target as Element).closest<HTMLElement>("[data-tooltip]"));
    const hide = () => setTarget(null);
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
    };
  }, []);
  useLayoutEffect(() => {
    if (!target || !ref.current) return;
    const r = target.getBoundingClientRect(),
      p = ref.current;
    p.style.left = `${Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.left + (r.width - p.offsetWidth) / 2))}px`;
    p.style.top = `${r.top > p.offsetHeight + 12 ? r.top - p.offsetHeight - 8 : r.bottom + 8}px`;
  }, [target]);
  return target?.isConnected
    ? createPortal(
        <div ref={ref} className="control-tooltip" role="tooltip">
          {target.dataset.tooltip}
        </div>,
        document.body,
      )
    : null;
}
