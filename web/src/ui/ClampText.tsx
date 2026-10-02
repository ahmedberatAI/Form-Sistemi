// Uzun düz metni CSS satır sınırıyla kısaltır; metin DOM'da TAM kalır (sayfa içi arama, ekran okuyucu, kopyalama).
// "Tamamını göster (N kelime)" / "Kısalt" düğmesi yalnız metin gerçekten taşıyorsa (ölçülünce) çıkar.
// 'Tam' görünümde taşan metin açık gelir (düğme "Kısalt" olarak kalır).
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { resolveDefaultOpen, useDetailLevel } from "../lib/detailLevel";
import { Button, cx } from "./basic";

export interface ClampTextProps {
  text: string | null | undefined;
  /** Dar ekranda görünen satır sayısı (varsayılan 10) */
  lines?: number;
  /** ≥ 900 px'te görünen satır sayısı (varsayılan 16) */
  wideLines?: number;
  className?: string;
  /** Sarmalayıcının kimliği */
  id?: string;
  /** false → 'tam' görünümde de kısaltılmış başlar */
  openInFull?: boolean;
}

/** Boşlukla ayrılmış sözcük sayısı (düğme etiketi için). */
export function countWords(text: string | null | undefined): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Düğme etiketi: kısaltılmışken "Tamamını göster (N kelime)", açıkken "Kısalt". */
export function clampToggleLabel(expanded: boolean, words: number): string {
  return expanded ? "Kısalt" : `Tamamını göster (${words} kelime)`;
}

/**
 * PlainText gibi `white-space: pre-wrap` düz metin çizer. Sarmalayıcı `.msg-body` sınıfını ALMAZ (tartışma mesajlarının
 * odak/silme denetimleri o sınıfa bakar).
 */
export function ClampText({ text, lines = 10, wideLines = 16, className, id, openInFull = true }: ClampTextProps) {
  const { level } = useDetailLevel();
  const openByDefault = resolveDefaultOpen(undefined, level, openInFull);
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const touched = useRef(false);
  const lastText = useRef(text);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  const openByDefaultRef = useRef(openByDefault);
  openByDefaultRef.current = openByDefault;

  // Taşma yalnız kısaltılmış durumda ölçülür; kart kapalıyken (boyut 0) ya da genişlik/yazı tipi değişince ResizeObserver yeniden ölçer.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Metin değiştiyse açık durum eskidir: kısaltılmışa dön, ölçümü ResizeObserver kısaltılmış boyutla yenilesin.
    if (lastText.current !== text) {
      lastText.current = text;
      touched.current = false;
      if (expandedRef.current) setExpanded(false);
    }
    const measure = () => {
      if (expandedRef.current) return;
      const over = el.scrollHeight > el.clientHeight + 1;
      setOverflowing(over);
      if (over && openByDefaultRef.current && !touched.current) setExpanded(true);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines, wideLines]);

  // Görünüm yoğunluğu 'tam'a geçerse (dokunulmamış metin) açılır; 'sade'ye geçerse kısalır.
  useLayoutEffect(() => {
    if (touched.current || !overflowing) return;
    setExpanded(openByDefault);
  }, [openByDefault, overflowing]);

  const words = countWords(text);
  return (
    <div className={cx("clamp-text", expanded && "is-expanded", className)} id={id}>
      <div
        ref={bodyRef}
        id={bodyId}
        className="prose plain-text clamp-text-body"
        style={{ "--clamp-lines": lines, "--clamp-lines-wide": wideLines } as CSSProperties}
      >
        {text ?? ""}
      </div>
      {overflowing ? (
        <Button
          variant="ghost"
          size="sm"
          className="clamp-text-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => {
            touched.current = true;
            setExpanded(!expanded);
          }}
        >
          {clampToggleLabel(expanded, words)}
        </Button>
      ) : null}
    </div>
  );
}
