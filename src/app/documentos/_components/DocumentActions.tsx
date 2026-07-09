type DocumentActionRecord = {
  id: string;
  tipo: string;
  status: string;
};

type DocumentActionsProps<TRecord extends DocumentActionRecord> = {
  registro: TRecord;
  canManageDocuments: boolean;
  canReview: boolean;
  canSign: boolean;
  opening: boolean;
  downloading: boolean;
  deleting: boolean;
  reviewing: boolean;
  containerClassName: string;
  onOpen: (registro: TRecord) => void | Promise<void>;
  onDownload: (registro: TRecord) => void | Promise<void>;
  onReview: (registro: TRecord) => void | Promise<void>;
  onEdit: (registro: TRecord) => void;
  onRemove: (registro: TRecord) => void | Promise<void>;
  onSign: (registro: TRecord) => void;
};

const secondaryButtonClassName =
  "min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50";

export function DocumentActions<TRecord extends DocumentActionRecord>({
  registro,
  canManageDocuments,
  canReview,
  canSign,
  opening,
  downloading,
  deleting,
  reviewing,
  containerClassName,
  onOpen,
  onDownload,
  onReview,
  onEdit,
  onRemove,
  onSign,
}: DocumentActionsProps<TRecord>) {
  return (
    <div
      className={containerClassName}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => void onOpen(registro)}
        disabled={opening || downloading}
        className={secondaryButtonClassName}
      >
        {opening ? "Abrindo..." : "Ver PDF"}
      </button>
      <button
        type="button"
        onClick={() => void onDownload(registro)}
        disabled={opening || downloading}
        className={secondaryButtonClassName}
      >
        {downloading ? "Baixando..." : "Baixar PDF"}
      </button>
      {canManageDocuments && canReview ? (
        <button
          type="button"
          onClick={() => void onReview(registro)}
          disabled={reviewing}
          className="min-w-[88px] rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {reviewing ? "Salvando..." : "Confirmar revisão"}
        </button>
      ) : null}
      {canManageDocuments ? (
        <button
          type="button"
          onClick={() => onEdit(registro)}
          className={secondaryButtonClassName}
        >
          Editar
        </button>
      ) : null}
      {canManageDocuments ? (
        <button
          type="button"
          onClick={() => void onRemove(registro)}
          disabled={deleting}
          className="min-w-[88px] rounded-full border border-red-200 px-3 py-1 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? "Removendo..." : "Remover"}
        </button>
      ) : null}
      {canManageDocuments && canSign ? (
        <button
          type="button"
          onClick={() => onSign(registro)}
          className="min-w-[88px] rounded-full bg-sky-500 px-3 py-1 text-white transition hover:bg-sky-400"
        >
          Assinar
        </button>
      ) : null}
    </div>
  );
}
