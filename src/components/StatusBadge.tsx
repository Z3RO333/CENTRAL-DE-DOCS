import { getStatusPresentation } from "@/lib/uiStatus";

export function StatusBadge({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  const presentation = getStatusPresentation(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${presentation.className} ${className}`}
    >
      {presentation.label}
    </span>
  );
}

