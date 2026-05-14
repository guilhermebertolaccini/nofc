import { type ReactNode } from "react";
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

/**
 * Transforma URLs http(s) em `<a>` sem `dangerouslySetInnerHTML` (texto escapado pelo React).
 */
export function renderTextWithLinks(text: string): ReactNode {
  if (!text) return null;
  const urlRe = /https?:\/\/[^\s<>"'`]+/gi;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  urlRe.lastIndex = 0;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const full = m[0];
    let core = full;
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
            "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300",
          )}
        >
          {core}
        </a>,
      );
      if (trailing) parts.push(trailing);
    } else {
      parts.push(full);
    }
    last = m.index + full.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}
