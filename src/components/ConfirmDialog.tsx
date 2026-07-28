"use client";

import { useCallback, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";

type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
};

type PendingConfirmation = ConfirmOptions & { resolve: (confirmed: boolean) => void };

function ConfirmationModal({
  pending,
  finish,
}: {
  pending: PendingConfirmation | null;
  finish: (confirmed: boolean) => void;
}) {
  const dialogRef = useAccessibleDialog<HTMLDivElement>(
    Boolean(pending),
    () => finish(false),
  );
  if (!pending) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-confirm-title"
      aria-describedby="shared-confirm-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) finish(false);
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl outline-none"
      >
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${pending.destructive ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>
          <TriangleAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 id="shared-confirm-title" className="mt-4 text-lg font-semibold text-slate-900">
          {pending.title}
        </h2>
        <p id="shared-confirm-description" className="mt-2 text-sm leading-relaxed text-slate-600">
          {pending.description}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => finish(false)}
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => finish(true)}
            className={`rounded-full px-4 py-2 text-xs font-semibold text-white transition ${pending.destructive ? "bg-rose-600 hover:bg-rose-500" : "bg-sky-600 hover:bg-sky-500"}`}
          >
            {pending.confirmLabel ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }));
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  return {
    confirm,
    confirmationDialog: <ConfirmationModal pending={pending} finish={finish} />,
  };
}

