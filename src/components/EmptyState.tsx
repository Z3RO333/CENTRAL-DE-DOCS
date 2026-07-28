import type { ReactNode } from "react";
import { SearchX } from "lucide-react";

export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm shadow-slate-200">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <SearchX className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-3 text-base font-semibold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-slate-500">{description}</p>
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

