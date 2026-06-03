"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type SimulacaoRole = "gerente_loja" | "prestador" | "colaborador";

export type Simulacao = {
  email: string;
  label: string;
  role: SimulacaoRole;
  detalhe?: string;
};

type SimulacaoContextValue = {
  simulacao: Simulacao | null;
  iniciar: (s: Simulacao) => void;
  encerrar: () => void;
};

const STORAGE_KEY = "simulacao_visao";
const COOKIE = "simular_email";

const SimulacaoContext = createContext<SimulacaoContextValue>({
  simulacao: null,
  iniciar: () => {},
  encerrar: () => {},
});

function setCookie(value: string | null) {
  if (typeof document === "undefined") return;
  if (value) {
    document.cookie = `${COOKIE}=${encodeURIComponent(value)}; path=/; max-age=86400; samesite=lax`;
  } else {
    document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}

// Filtros/cache de documentos do usuário NÃO devem vazar entre identidades:
// limpa o estado salvo ao entrar/sair de simulação (evita 403 por filtro de
// prestador/loja que a identidade simulada não pode ver).
function limparEstadoDocumentos() {
  if (typeof window === "undefined") return;
  try {
    const ss = window.sessionStorage;
    Object.keys(ss)
      .filter((k) => k.startsWith("documentos:") || k.startsWith("documentos-"))
      .forEach((k) => ss.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function SimulacaoProvider({ children }: { children: React.ReactNode }) {
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);

  // restaura simulação salva (sobrevive a reload)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Simulacao;
        if (parsed?.email) {
          setSimulacao(parsed);
          setCookie(parsed.email);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const iniciar = useCallback((s: Simulacao) => {
    setSimulacao(s);
    setCookie(s.email);
    limparEstadoDocumentos();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, []);

  const encerrar = useCallback(() => {
    setSimulacao(null);
    setCookie(null);
    limparEstadoDocumentos();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ simulacao, iniciar, encerrar }),
    [simulacao, iniciar, encerrar],
  );

  return (
    <SimulacaoContext.Provider value={value}>{children}</SimulacaoContext.Provider>
  );
}

export function useSimulacao() {
  return useContext(SimulacaoContext);
}
