import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

type Tone = "error" | "warning" | "success" | "info";

const STYLE: Record<Tone, string> = {
  error: "bg-rose-50 text-rose-800 ring-rose-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
};

const ICON = {
  error: CircleAlert,
  warning: TriangleAlert,
  success: CircleCheck,
  info: Info,
};

export function FeedbackBanner({
  tone,
  children,
  className = "",
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = ICON[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm ring-1 ring-inset ${STYLE[tone]} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

