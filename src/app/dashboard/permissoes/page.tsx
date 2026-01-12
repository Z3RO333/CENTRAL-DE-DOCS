"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PermissoesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/usuarios");
  }, [router]);

  return null;
}
