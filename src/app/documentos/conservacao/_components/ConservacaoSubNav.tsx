"use client";

import Link from "next/link";

type ConservacaoSubNavProps = {
  active: "documentos" | "notas-fiscais";
};

export function ConservacaoSubNav({ active }: ConservacaoSubNavProps) {
  const tabs: { key: ConservacaoSubNavProps["active"]; label: string; href: string }[] = [
    { key: "documentos", label: "Documentos", href: "/documentos/conservacao" },
    {
      key: "notas-fiscais",
      label: "Notas Fiscais",
      href: "/documentos/conservacao/notas-fiscais",
    },
  ];

  return (
    <nav className="flex gap-2 border-b border-slate-200 pb-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            active === tab.key
              ? "bg-sky-600 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
