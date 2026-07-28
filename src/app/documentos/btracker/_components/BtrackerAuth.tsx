"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Copy, ExternalLink, Link2, Link2Off, Loader2, X } from "lucide-react";

type Props = {
  connected: boolean;
  onConnected: () => void;
  onDisconnected: () => void;
};

// Bookmarklet: roda na página do BTracker SEM abrir DevTools (evita o anti-debugger).
// Intercepta XHR e fetch, captura o token do BTracker (token_type=access) e copia para a área de transferência.
const BOOKMARKLET =
  `javascript:(()=>{let done=false;const grab=v=>{if(done||typeof v!=='string')return false;const t=v.replace(/^Bearer\\s+/i,'');const parts=t.split('.');if(parts.length!==3||t.indexOf('eyJ')!==0)return false;try{const p=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));if(!(p.token_type==='access'||p.user_id))return false}catch(e){return false}done=true;const ok=()=>alert('✓ Token BTracker copiado! Volte ao formulario e cole (Ctrl+V).');navigator.clipboard.writeText(t).then(ok,()=>prompt('Copie o token (Ctrl+C):',t));return true};const o=XMLHttpRequest.prototype.setRequestHeader;XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{if(String(k).toLowerCase()==='authorization')grab(v)}catch(e){}return o.apply(this,arguments)};const f=window.fetch;window.fetch=function(){try{const a=arguments[1];const h=a&&a.headers;if(h){const t=h.get?h.get('authorization'):(h.authorization||h.Authorization);grab(t)}}catch(e){}return f.apply(this,arguments)};alert('Pronto! Agora clique em qualquer menu do BTracker (ex: Pendencias) sem atualizar a pagina. O token sera copiado automaticamente.')})()`;

export function BtrackerAuth({ connected, onConnected, onDisconnected }: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  // Define o href javascript: diretamente no DOM (React sanitiza javascript: hrefs)
  useEffect(() => {
    if (open && linkRef.current) {
      linkRef.current.setAttribute("href", BOOKMARKLET);
    }
  }, [open]);

  async function handleSave() {
    if (!token.trim()) {
      setError("Cole o token antes de confirmar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let jwt = token.trim();
      try {
        const parsed = JSON.parse(jwt) as Record<string, unknown>;
        if (typeof parsed.secret === "string") jwt = parsed.secret;
        else if (typeof parsed.access === "string") jwt = parsed.access;
      } catch {
        /* raw JWT */
      }

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

  function copyBookmarklet() {
    void navigator.clipboard.writeText(BOOKMARKLET);
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
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-[11px] leading-5 text-sky-800">
              Configuração única: arraste o botão abaixo para a barra de favoritos do navegador.
              Depois é só clicar nele dentro do BTracker para copiar seu token.
            </p>

            <ol className="mb-4 space-y-3 text-xs text-slate-700">
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">1</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span>Arraste este botão para a barra de favoritos:</span>
                  <a
                    ref={linkRef}
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    draggable
                    className="inline-flex cursor-grab items-center gap-1 rounded-lg border border-sky-300 bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white active:cursor-grabbing"
                  >
                    <Bookmark className="h-3 w-3" />
                    Pegar token BTracker
                  </a>
                  <button
                    type="button"
                    onClick={copyBookmarklet}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-slate-100"
                    title="Copiar código (alternativa: criar favorito manualmente e colar como URL)"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? "Copiado!" : "Copiar código"}
                  </button>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">2</span>
                <div>
                  Abra o BTracker e faça login.
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
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">3</span>
                Com o BTracker aberto, clique no favorito <strong>“Pegar token BTracker”</strong>, depois clique em qualquer menu (ex: Pendências). O token é copiado automaticamente.
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">4</span>
                Volte aqui, cole abaixo (Ctrl+V) e clique em Confirmar.
              </li>
            </ol>

            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              placeholder="Cole o token aqui (eyJhbG...)"
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
