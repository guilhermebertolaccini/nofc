import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Aceita só http(s) para evitar javascript: e outros esquemas em href. */
export function hrefIfSafeHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* ignorar */
  }
  return null;
}

/** Normaliza telefone BR para dígitos com DDI 55 quando aplicável. */
export function normalizeBrazilPhoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  return digits;
}

function isValidBrazilPhoneDigits(digits: string): boolean {
  if (digits.length === 10 || digits.length === 11) return true;
  if (digits.length === 12 || digits.length === 13) return digits.startsWith("55");
  return false;
}

type TextSegment =
  | { type: "url"; start: number; end: number; raw: string }
  | { type: "phone"; start: number; end: number; raw: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const PHONE_RE =
  /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9?\d{4})[-\s]?\d{4}/g;

function collectSegments(text: string): TextSegment[] {
  const urls: TextSegment[] = [];
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    urls.push({
      type: "url",
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
    });
  }

  const insideUrl = (start: number, end: number) =>
    urls.some((u) => start >= u.start && end <= u.end);

  const phones: TextSegment[] = [];
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (insideUrl(start, end)) continue;
    const raw = m[0];
    const digits = raw.replace(/\D/g, "");
    if (!isValidBrazilPhoneDigits(digits)) continue;
    phones.push({ type: "phone", start, end, raw });
  }

  const merged = [...urls, ...phones].sort((a, b) => a.start - b.start);
  const out: TextSegment[] = [];
  for (const seg of merged) {
    const prev = out[out.length - 1];
    if (prev && seg.start < prev.end) continue;
    out.push(seg);
  }
  return out;
}

/**
 * Transforma URLs http(s) e telefones BR em elementos clicáveis.
 */
export function renderTextWithLinks(
  text: string,
  onPhoneClick?: (phone: string) => void,
  isOutbound?: boolean,
): ReactNode {
  const source =
    typeof text === "string" ? text : text == null ? "" : String(text);
  if (!source) return null;

  const segments = collectSegments(source);
  if (segments.length === 0) return source;

  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  const canHandlePhone = typeof onPhoneClick === "function";

  for (const seg of segments) {
    if (seg.start > last) parts.push(source.slice(last, seg.start));

    if (seg.type === "url") {
      let core = seg.raw;
      let trailing = "";
      while (
        core.length > 0 &&
        /[),.;:!?\]}'"»"'’]$/u.test(core)
      ) {
        trailing = core.slice(-1) + trailing;
        core = core.slice(0, -1);
      }
      const safe = hrefIfSafeHttpUrl(core);
      if (safe) {
        parts.push(
          <a
            key={`link-${k++}`}
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "underline break-all font-medium",
              isOutbound
                ? "text-blue-200 hover:text-white"
                : "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300",
            )}
          >
            {core}
          </a>,
        );
        if (trailing) parts.push(trailing);
      } else {
        parts.push(seg.raw);
      }
    } else if (seg.type === "phone" && canHandlePhone) {
      const cleanPhone = normalizeBrazilPhoneDigits(seg.raw);
      parts.push(
        <button
          key={`phone-${k++}`}
          type="button"
          className={cn(
            "inline underline cursor-pointer font-semibold break-all bg-transparent border-0 p-0 text-left align-baseline",
            isOutbound
              ? "text-green-200 hover:text-white"
              : "text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300",
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPhoneClick(cleanPhone);
          }}
        >
          {seg.raw}
        </button>,
      );
    } else {
      parts.push(seg.raw);
    }

    last = seg.end;
  }

  if (last < source.length) parts.push(source.slice(last));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return <Fragment>{parts}</Fragment>;
}
