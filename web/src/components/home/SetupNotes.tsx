// Ana sayfa › oy hakkı notu (doğrulanmış üye): siyasi görüş açık rızası yoksa ya da üye 18 yaşından küçükse tek satırlık not ve
// Profil bağlantısı. 'Notu gizle' notu bu cihazda gizler (lib/prefs: forum.dismissed; okuma/yazma try/catch). Aynı bilgi
// VotePanel'de ve Profil'de her zaman görünür kalır; burada gizlemek yalnız Ana sayfa tekrarını kaldırır. Düğme adı 'Kapat'
// DEĞİLDİR (e2e'deki /Kapat/ seçicisiyle çakışmasın).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Me } from "@forum/shared";
import { addDismissed, getDismissed, getDismissedSync } from "../../lib/prefs";
import { routes } from "../../lib/routes";
import { Button, Icon } from "../../ui";
import "./home.css";

export interface SetupNote {
  /** Gizleme anahtarı (kullanıcıya özgü: aynı cihazı paylaşan başka üyenin notu gizlenmez) */
  key: string;
  text: string;
  link?: { label: string; to: string };
}

/** Gösterilecek notlar (saf). Yalnız doğrulanmış üye; Profil bağlantısı tek kez (ilk notta). */
export function setupNotes(user: Pick<Me, "id" | "status" | "politicalConsent" | "isAdult"> | null): SetupNote[] {
  if (!user || user.status !== "verified") return [];
  const notes: SetupNote[] = [];
  if (!user.politicalConsent) {
    notes.push({ key: `consent:${user.id}`, text: "Oy verebilmek için siyasi görüş açık rızası gerekir.", link: { label: "Profil'de verin", to: routes.profile() } });
  }
  if (!user.isAdult) {
    notes.push({
      key: `minor:${user.id}`,
      text: "18 yaşından küçük üyeler oy veremez; öneri açabilir, destekleyebilir ve tartışmalara katılabilirsiniz.",
      link: notes.length ? undefined : { label: "Profil", to: routes.profile() },
    });
  }
  return notes;
}

/** Notun ardından gelen ilk odaklanabilir öğe (not gizlenince odak boşa düşmesin). */
function focusableAfter(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  const all = Array.from(
    document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled])'),
  );
  return all.find((x) => !el.contains(x) && !!(el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null;
}

export function SetupNotes({ user }: { user: Pick<Me, "id" | "status" | "politicalConsent" | "isAdult"> | null }) {
  const [dismissed, setDismissed] = useState<string[]>(getDismissedSync);
  const boxRef = useRef<HTMLDivElement>(null);

  // Android'de kalıcı depo (Preferences) aynadan farklı olabilir: ilk çizimden sonra birleşik liste okunur.
  useEffect(() => {
    let alive = true;
    void getDismissed().then((d) => {
      if (alive) setDismissed(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  const notes = setupNotes(user).filter((n) => !dismissed.includes(n.key));
  if (!notes.length) return null;

  const hide = () => {
    const keys = notes.map((n) => n.key);
    const next = focusableAfter(boxRef.current);
    setDismissed((d) => [...new Set([...d, ...keys])]);
    void addDismissed(keys);
    requestAnimationFrame(() => next?.focus());
  };

  return (
    <div className="home-note" role="note" ref={boxRef}>
      <Icon name="info" size={18} className="home-note-icon" />
      <div className="home-note-body">
        {notes.map((n) => (
          <p key={n.key}>
            {n.text}
            {n.link ? (
              <>
                {" "}
                <Link to={n.link.to} className="home-inline-link">
                  {n.link.label} <Icon name="chevronRight" size={14} />
                </Link>
              </>
            ) : null}
          </p>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="home-note-hide" onClick={hide}>
        Notu gizle
      </Button>
    </div>
  );
}
