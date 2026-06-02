"use client";

import { useState } from "react";
import { Copy, ExternalLink, Link2, Link2Off, Loader2, X } from "lucide-react";

type Props = {
  connected: boolean;
  onConnected: () => void;
  onDisconnected: () => void;
};

const CONSOLE_CMD =
  `copy([...Object.values(localStorage),...Object.values(sessionStorage)].map(v=>{try{const o=JSON.parse(v);return o.access||(o.token_type==='access'?o.secret:null)}catch{return /^eyJ[\\w-]+\\.[\\w-]+\\.[\\w-]+$/.test(v)?v:null}}).find(Boolean)||'NAO ENCONTRADO - faca login no BTracker primeiro')`;

export function BtrackerAuth({ connected, onConnected, onDisconnected }: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSave() {
    if (!token.trim()) { setError("Cole o token antes de confirmar."); return; }
    setSaving(true);
    setError(null);
    try {
      // The pasted value may be the raw JWT or a JSON string like '{"token_type":"access",...}'
      let jwt = token.trim();
      try {
        const parsed = JSON.parse(jwt) as Record<string, unknown>;
        if (typeof parsed === "object" && typeof parsed.secret === "string") jwt = parsed.secret;
        else if (typeof parsed.access === "string") jwt = parsed.access;
      } catch { /* raw JWT, use as is */ }

      // Validate it looks like a JWT
      if (!jwt.startsWith("eyJ") || jwt.split(".").length !== 3) {
        throw new Error("Formato inválido — cole o token JWT completo.");
      }

      const res = await fetch("/api/btracker/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jwt }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Status ${res.status}`);

      setToken("");
      setOpen(false);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar token");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    await fetch("/api/btracker/auth", { method: "DELETE" });
    onDisconnected();
  }

  function copyCmd() {
    void navigator.clipboard.writeText(CONSOLE_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
        <Link2 className="h-3.5 w-3.5" />
        BTracker conectado
        <button
          type="button"
          onClick={() => void handleDisconnect()}
          className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] text-green-600 hover:bg-green-100"
        >
          desconectar
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
      >
        <Link2Off className="h-3.5 w-3.5" />
        Conectar ao BTracker
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Conectar ao BTracker</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <ol className="mb-4 space-y-3 text-xs text-slate-700">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">1</span>
                <div>
                  Abra o BTracker e autentique-se normalmente.
                  <a
                    href="https://btracker.bemol.com.br/notas/recebimento"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex items-center gap-0.5 font-semibold text-sky-600 hover:underline"
                  >
                    Abrir BTracker <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">2</span>
                <div>
                  Com o BTracker aberto, pressione <kbd className="rounded border border-slate-200 bg-slate-100 px-1">F12</kbd> → aba <strong>Console</strong> e cole o comando abaixo:
                </div>
              </li>
            </ol>

            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase text-slate-400">Console do BTracker</span>
                <button
                  type="button"
                  onClick={copyCmd}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-200"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
              <pre className="overflow-x-auto px-3 py-2 text-[10px] leading-5 text-slate-700">{CONSOLE_CMD}</pre>
            </div>

            <ol className="mb-4 space-y-3 text-xs text-slate-700" start={3}>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">3</span>
                O token é copiado automaticamente. Cole abaixo (Ctrl+V) e clique em Confirmar.
              </li>
            </ol>

            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] text-slate-700 placeholder-slate-300 focus:border-sky-400 focus:outline-none"
            />

            {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !token.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                {saving ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
