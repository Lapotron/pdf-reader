import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; size?: "sm" | "md" };

export function Button({ variant = "outline", size = "md", className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
        variant === "outline" && "border border-line bg-panel hover:bg-panel-2",
        variant === "ghost" && "hover:bg-panel-2",
        variant === "danger" && "border border-line text-danger hover:bg-panel-2",
        className,
      )}
    />
  );
}

export function IconButton({ label, active, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none",
        active ? "bg-accent-soft text-accent" : "text-fg hover:bg-panel-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange(v: boolean): void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx("flex items-start justify-between gap-4 py-2", disabled && "opacity-50")}>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  className,
}: {
  label?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
  format?: (v: number) => string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("py-1.5", className)}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <label htmlFor={id}>{label}</label>
          <span className="tabular-nums text-muted">{format(value)}</span>
        </div>
      )}
      <input id={id} type="range" className="range w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Select<T extends string>({ label, value, options, onChange, description }: { label: ReactNode; value: T; options: { value: T; label: string }[]; onChange(v: T): void; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="min-w-0">
        <label htmlFor={id} className="block text-sm">
          {label}
        </label>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className="h-8 max-w-[55%] rounded-lg border border-line bg-panel px-2 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextInput({ label, value, onChange, type = "text", placeholder, description, autoComplete = "off" }: { label: ReactNode; value: string; onChange(v: string): void; type?: string; placeholder?: string; description?: ReactNode; autoComplete?: string }) {
  const id = useId();
  return (
    <div className="py-2">
      <label htmlFor={id} className="mb-1 block text-sm">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm"
      />
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
    </div>
  );
}

export function ColorInput({ label, value, onChange }: { label: ReactNode; value: string; onChange(v: string): void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-line bg-panel p-0.5" />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange(v: T): void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx("rounded-md px-2.5 py-1 text-[13px] transition-colors", value === o.value ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
  bodyClassName = "min-h-0 flex-1 overflow-auto",
}: {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  /** Classes for the body wrapper; pass a non-scrolling layout to manage scrolling inside. */
  bodyClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cx("flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel text-fg shadow-2xl", wide ? "max-w-4xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className={bodyClassName}>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Popover anchored above/below a trigger element. */
export function Popover({ trigger, children, align = "center", side = "top", width = 280, label }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: "start" | "center" | "end"; side?: "top" | "bottom"; width?: number; label: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => setOpen(false);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 0;
      let left = align === "start" ? r.left : align === "end" ? r.right - width : r.left + r.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = side === "top" ? r.top - h - 8 : r.bottom + 8;
      if (side === "top" && top < 8) top = r.bottom + 8;
      if (side === "bottom" && top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
      setPos({ left, top });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [open, align, side, width]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <>
      <span ref={anchor} className="inline-flex">
        {trigger(open, () => setOpen((o) => !o))}
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
            className="fixed z-40 rounded-xl border border-line bg-panel p-3 text-fg shadow-xl"
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      {value === null ? <div className="indeterminate h-full w-1/3 rounded-full bg-accent" /> : <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />}
    </div>
  );
}

export function Section({ title, children, description }: { title: ReactNode; children: ReactNode; description?: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-b-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px]">{children}</kbd>;
}
