"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Link2Off, Loader2 } from "lucide-react";
import { BTRACKER_CLIENT_ID, BTRACKER_TENANT_ID } from "@/lib/btrackerApi";

type Status = "idle" | "loading" | "connected" | "error";

declare global {
  interface Window {
    msal?: {
      PublicClientApplication: new (config: unknown) => MsalInstance;
    };
  }
}

interface MsalInstance {
  loginPopup(req: unknown): Promise<{ idToken: string; accessToken: string; account: { name: string; username: string } }>;
  acquireTokenSilent(req: unknown): Promise<{ idToken: string; accessToken: string; account: { name: string; username: string } }>;
}

type Props = {
  connected: boolean;
  onConnected: () => void;
  onDisconnected: () => void;
};

export function BtrackerAuth({ connected, onConnected, onDisconnected }: Props) {
  const [status, setStatus] = useState<Status>(connected ? "connected" : "idle");
  const [error, setError] = useState<string | null>(null);
  const msalRef = useRef<MsalInstance | null>(null);

  // load MSAL from CDN once
  useEffect(() => {
    if (window.msal) return;
    const script = document.createElement("script");
    script.src = "https://alcdn.msauth.net/browser/2.13.1/js/msal-browser.min.js";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  async function getMsalInstance(): Promise<MsalInstance> {
    // wait up to 5s for MSAL to load
    for (let i = 0; i < 50; i++) {
      if (window.msal?.PublicClientApplication) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!window.msal?.PublicClientApplication) throw new Error("MSAL nao carregou.");

    if (!msalRef.current) {
      msalRef.current = new window.msal.PublicClientApplication({
        auth: {
          clientId: BTRACKER_CLIENT_ID,
          authority: `https://login.microsoftonline.com/${BTRACKER_TENANT_ID}`,
          redirectUri: "https://btracker.bemol.com.br",
          navigateToLoginRequestUrl: false,
        },
        cache: { cacheLocation: "sessionStorage" },
      });
    }
    return msalRef.current;
  }

  async function connect() {
    setStatus("loading");
    setError(null);
    try {
      const msal = await getMsalInstance();
      const scopes = ["openid", "profile", "email", "User.Read"];

      let result;
      try {
        // Try silent first (SSO – works if user recently authenticated)
        result = await msal.acquireTokenSilent({ scopes });
      } catch {
        // Fallback to popup
        result = await msal.loginPopup({ scopes });
      }

      const res = await fetch("/api/btracker/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: result.idToken,
          accessToken: result.accessToken,
          name: result.account.name,
          email: result.account.username,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Status ${res.status}`);
      }

      setStatus("connected");
      onConnected();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha na autenticacao";
      setError(msg);
      setStatus("error");
    }
  }

  async function disconnect() {
    await fetch("/api/btracker/auth", { method: "DELETE" });
    setStatus("idle");
    onDisconnected();
  }

  if (status === "connected") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
        <Link2 className="h-3.5 w-3.5" />
        BTracker conectado
        <button
          onClick={() => void disconnect()}
          className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] text-green-600 hover:bg-green-100"
        >
          desconectar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => void connect()}
        disabled={status === "loading"}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Link2Off className="h-3.5 w-3.5" />
        )}
        {status === "loading" ? "Autenticando..." : "Conectar ao BTracker"}
      </button>
      {error ? (
        <p className="max-w-xs text-[11px] text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
