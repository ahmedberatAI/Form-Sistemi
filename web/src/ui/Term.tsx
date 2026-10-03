// Satır içi sözlük terimi: terim ekranda aynen yazıldığı gibi kalır ('Terim korunur, günlük karşılık yanına eklenir'); dokununca
// (ya da Enter/Boşluk ile) günlük karşılığı, 1-3 cümlelik tanımı ve 'Yönetmelikte ›' bağlantısı bir pencerede (Modal sheet) açılır.
// Masaüstündeki fare ipucu (title) kalır; dokunmatikte asıl açıklama bu penceredir. Kaynak: lib/glossary.ts.
//
//   <Term id="kopru-testi">Köprü testi</Term>        → görünen metin sizin yazdığınız (çekimli biçim de olabilir)
//   <Term id="taahhut">taahhüdüyle</Term>
//   <Term id="onay-esigi" />                         → children yoksa sözlükteki terim
//
// Term YALNIZ düz metin akışına (paragraf, tanım listesi etiketi, rozet, kontrol satırı) konur. Şunların İÇİNE KONMAZ:
// başlık (h1–h4, Card başlığı), form etiketi, düğme, bağlantı, <summary> ve Uzlaşma ile İtiraz panelleri — iç içe etkileşimli öğe
// olur ve e2e'nin dayandığı düğme/başlık adlarını değiştirir. Pencere document.body'ye taşınır (<p> ya da <dt> içinde
// <dialog>/<header> geçersiz olurdu); kapalıyken hiçbir şey çizilmez, bu yüzden sunucu tarafı çizimde sorun çıkmaz.
//
// Bağlantı kipi (TermLinksProvider): yalnız bellekte tutulan bir formun yanında (Yeni öneri, açık vekâlet formu) pencere
// bağlantıları sayfadan ÇIKARMAZ: web'de yeni sekmede açılır, yerel uygulamada (target="_blank" aynı görünümde açılır ve formu
// siler) çizilmez, dayanak madde düz metin kalır. Benzer öneri önizlemesiyle (PrecheckPanel › SimilarProposalPreview) aynı kural.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { findTerm, termAnchor, type GlossaryEntry, type TermId } from "../lib/glossary";
import { routes } from "../lib/routes";
import { cx } from "./basic";
import { Modal } from "./Modal";

/**
 * Pencere (ve form yanı açıklama) bağlantılarının davranışı:
 * - "page": aynı sekmede gezinir, pencere kapanır (varsayılan);
 * - "newTab": yeni sekmede açılır, adında '(yeni sekmede açılır)' notu vardır; sayfadaki form yerinde kalır;
 * - "none": bağlantı çizilmez (yerel uygulamada form yanı); bağlantının bilgisi (dayanak madde) düz metin olarak kalır.
 */
export type TermLinkMode = "page" | "newTab" | "none";

const TermLinkModeContext = createContext<TermLinkMode>("page");

/** Alt ağaçtaki Term pencerelerinin (ve FindingList madde bağlantısının) bağlantı kipi. */
export function TermLinksProvider({ mode, children }: { mode: TermLinkMode; children: ReactNode }) {
  return <TermLinkModeContext.Provider value={mode}>{children}</TermLinkModeContext.Provider>;
}

export function useTermLinkMode(): TermLinkMode {
  return useContext(TermLinkModeContext);
}

/** Yalnız bellekte tutulan formun yanındaki kip (saf): yerel uygulamada bağlantısız, web'de yeni sekme. */
export function formTermLinkMode(native: boolean): TermLinkMode {
  return native ? "none" : "newTab";
}

/** Kipin bağlantı öznitelikleri (saf): null → bağlantı çizilmez; `note` → adda '(yeni sekmede açılır)'. */
export function termLinkAttrs(mode: TermLinkMode): { target?: "_blank"; rel?: string; note: boolean } | null {
  if (mode === "none") return null;
  return mode === "newTab" ? { target: "_blank", rel: "noopener", note: true } : { note: false };
}

/** Yeni sekme notu (bağlantının adına girer). */
export const NEW_TAB_NOTE = "(yeni sekmede açılır)";

/**
 * Kipe göre bağlantı. "page" → aynı sekme (`onNavigate` çağrılır, ör. pencere kapanır); "newTab" → yeni sekme + not;
 * "none" → `fallback` (verilmezse hiçbir şey).
 */
export function TermLink({ to, onNavigate, className, fallback = null, children }: { to: string; onNavigate?: () => void; className?: string; fallback?: ReactNode; children: ReactNode }) {
  const attrs = termLinkAttrs(useTermLinkMode());
  if (!attrs) return <>{fallback}</>;
  return (
    <Link to={to} className={className} target={attrs.target} rel={attrs.rel} onClick={attrs.target ? undefined : onNavigate}>
      {children}
      {attrs.note ? <span className="term-newtab"> {NEW_TAB_NOTE}</span> : null}
    </Link>
  );
}

export interface TermProps {
  /** Sözlük kimliği (lib/glossary.ts › GLOSSARY); derleme zamanında denetlenir */
  id: TermId;
  /** Görünen metin; verilmezse sözlükteki terim. Çekimli biçim ya da tam etiket olabilir. */
  children?: ReactNode;
  className?: string;
}

/**
 * Pencerenin içeriği: günlük karşılık, tanım, varsa sembol ve yönetmelik bağlantısı.
 * `glossaryLink`: 'Sözlükte ›' (Keşfet ve doğrula sayfasında terimin yeri). Term penceresinde açıktır; sözlüğün kendi
 * sayfasında (aynı gövde terim listesinde de çizilir) kapalı kalır, çünkü orada bağlantı kendine döner.
 * Bağlantılar TermLinksProvider kipine uyar; "none" kipinde dayanak madde düz metin kalır, 'Sözlükte ›' satırı çizilmez.
 */
export function TermBody({ entry, onNavigate, glossaryLink = false }: { entry: GlossaryEntry; onNavigate?: () => void; glossaryLink?: boolean }) {
  const linked = termLinkAttrs(useTermLinkMode()) !== null;
  return (
    <div className="term-dialog stack-sm">
      <p className="term-plain">
        <strong>Günlük dille:</strong> {entry.plain}.
      </p>
      <p className="term-definition">{entry.definition}</p>
      {entry.symbol ? (
        <p className="small muted">
          Sembol: <span className="term-symbol">{entry.symbol}</span>
        </p>
      ) : null}
      {entry.bylawLink ? (
        <p className="small term-bylaw">
          <span className="muted">{entry.bylawLink.label}</span>
          {linked ? (
            <>
              {" · "}
              <TermLink to={entry.bylawLink.to} onNavigate={onNavigate}>
                Yönetmelikte ›
              </TermLink>
            </>
          ) : null}
        </p>
      ) : null}
      {glossaryLink && linked ? (
        <p className="small term-glossary">
          <TermLink to={routes.kesfet({ bolum: termAnchor(entry.id) })} onNavigate={onNavigate}>
            Sözlükte ›
          </TermLink>
        </p>
      ) : null}
    </div>
  );
}

export function Term({ id, children, className }: TermProps) {
  const entry = findTerm(id);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Pencere kapanınca odak terime döner (Modal kendi geri verişini açılış anındaki etkin öğeye yapar; Safari düğmeye
  // tıklayınca odaklamaz, o durumda terim kaybolurdu).
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Bilinmeyen kimlik (tür denetimini aşan çağrı): terimi bozmadan düz metin olarak göster.
  if (!entry) return <>{children}</>;

  return (
    <>
      <button
        ref={button}
        type="button"
        className={cx("term", className)}
        aria-haspopup="dialog"
        title={`Günlük dille: ${entry.plain}`}
        onClick={(e) => {
          // Terim tıklanabilir bir kabın (satır, kart) içindeyse kabın tıklaması tetiklenmez.
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children ?? entry.term}
      </button>
      {open
        ? createPortal(
            // React olayları portaldan üst bileşenlere de kabarır; pencerenin içindeki tıklamalar terimin kabına ulaşmasın.
            <div className="term-portal" onClick={(e) => e.stopPropagation()}>
              <Modal open onClose={() => setOpen(false)} title={entry.term} size="sm" sheet>
                <TermBody entry={entry} onNavigate={() => setOpen(false)} glossaryLink />
              </Modal>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
