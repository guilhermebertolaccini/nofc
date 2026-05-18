/**
 * Extrai o ID oficial da mensagem WhatsApp (Baileys `key.id`) da resposta da
 * Evolution após sendText, sendMedia, sendWhatsAppAudio, sendTemplate, etc.
 * Formatos variam por versão; este helper aceita os mais comuns.
 */
export function extractWaMessageIdFromEvolutionSendResponse(
  data: unknown,
): string | null {
  if (data == null) return null;

  const fromKeyLike = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v).trim();
    if (typeof v === "object" && v !== null && "id" in v) {
      const id = (v as { id?: unknown }).id;
      if (typeof id === "string" && id.trim()) return id.trim();
      if (typeof id === "number" && Number.isFinite(id)) return String(id);
    }
    return null;
  };

  if (typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const fromMessage =
    typeof d.message === "object" && d.message !== null
      ? (d.message as Record<string, unknown>)
      : null;

  const direct =
    fromKeyLike(d.key) ||
    (fromMessage ? fromKeyLike(fromMessage.key) : null) ||
    fromKeyLike(d.message) ||
    (typeof d.messageId === "string" && d.messageId.trim()
      ? d.messageId.trim()
      : null) ||
    (typeof d.message_id === "string" && d.message_id.trim()
      ? d.message_id.trim()
      : null);

  if (direct) return direct;

  if (d.data !== undefined && d.data !== data) {
    return extractWaMessageIdFromEvolutionSendResponse(d.data);
  }

  return null;
}
