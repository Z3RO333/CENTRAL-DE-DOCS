import { supabase } from "@/lib/supabaseClient";

export type UploadedDocument = {
  path: string;
  name: string;
  type: string;
  size: number;
};

export async function uploadDocumentFile(
  file: File,
  category: string,
): Promise<UploadedDocument> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");

  const formData = new FormData();
  formData.set("file", file);
  formData.set("category", category);

  const response = await fetch("/api/uploads/documentos", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    upload?: UploadedDocument;
    error?: string;
  };
  if (!response.ok || !payload.upload) {
    throw new Error(payload.error ?? "Não foi possível enviar o arquivo.");
  }
  return payload.upload;
}

