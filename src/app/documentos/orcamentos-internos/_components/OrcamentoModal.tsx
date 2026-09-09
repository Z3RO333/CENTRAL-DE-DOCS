"use client";

import { useEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function OrcamentoModal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const dialogRef = useAccessibleDialog<HTMLDivElement>(mounted && open, onClose);

  useEffect(() => {
    if (!mounted || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted, open]);

  if (!mounted) return null;

  // Keep the intake mounted so files, reviews and running analyses survive closing.
  return createPortal(
    <div
      hidden={!open}
      className={open ? "fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6" : "hidden"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:max-h-[calc(100dvh-3rem)] ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5 sm:px-6">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
            <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Fechar ${title.toLowerCase()}`}
            className="shrink-0 rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
