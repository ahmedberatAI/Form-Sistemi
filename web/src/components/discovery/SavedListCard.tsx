// Profil › 'Listem': 'Listeme ekle' ile kaydedilen öneri ve konular (yalnız sahibine; en son eklenen önce, ekranda Öneriler ve Konular
// diye gruplu). Her satır kaydın sayfasına giden bağlantı + 'Çıkar' düğmesidir; çıkarınca odak EKRANDAKİ sıradaki satırın düğmesine
// (yoksa öncekine, liste boşalırsa boş durum satırına) geçer. 'Çıkar' düğmesinin adı başlığı değil numarayı taşır ("Çıkar: #K-12"):
// başlıklar ayrılmış parçaları ('Kapat' …) içerebilir; başlık aria-describedby ile okunur. Kartın altında 'Kişisel sıralama' tercihi
// (siyasi görüş rızasına ek olarak kişisel sıralamayı kapatır; sunucuda users.personal_ranking, KVKK dökümünde). Kart katlanmaz
// (Profil'in 'Tam' görünüm sözleşmesi: katlı kart sayısı değişmez). Öneriler sayfasında da 'Listem' sekmesi vardır. Kayıtlar KVKK
// dökümüne girer ve hesap silmede silinir (sunucu).
import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PROPOSAL_STATUS_LABELS, type SavedItem } from "@forum/shared";
import { getSaved, unsaveItem, updateConsents } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { formatNumber, proposalRef, topicRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Button, Card, Checkbox, ErrorView, Spinner, Time, useToast } from "../../ui";
import { PROFILE_ANCHORS } from "../system/accountLogic";
import "./discovery.css";

/** Öneriler sayfasındaki Listem sekmesi. */
export const SAVED_PROPOSALS_HREF = `${routes.proposals()}?sekme=listem`;

/** Kartın tek satırlık özeti (saf): "3 öneri ve 1 konu" / "Listeniz boş". */
export function savedSummary(items: readonly Pick<SavedItem, "type">[]): string {
  const p = items.filter((x) => x.type === "proposal").length;
  const t = items.length - p;
  if (!items.length) return "Listeniz boş";
  return [p ? `${formatNumber(p)} öneri` : null, t ? `${formatNumber(t)} konu` : null].filter(Boolean).join(" ve ");
}

/** Satırın bağlantısı, numarası ve durum metni (saf). */
export function savedRow(item: SavedItem): { href: string; ref: string; title: string; status: string } {
  if (item.type === "proposal") {
    const p = item.proposal;
    return { href: routes.proposal(p.id), ref: proposalRef(p.seq), title: p.title, status: PROPOSAL_STATUS_LABELS[p.status] ?? p.status };
  }
  const t = item.topic;
  return { href: routes.topic(t.id), ref: topicRef(t.seq), title: t.title, status: t.status === "active" ? "Yürürlükte" : "Arşivlendi" };
}

/** Ekrandaki (görsel) sıra: önce öneriler, sonra konular; her grupta sunucu sırası (en son eklenen önce). */
export function visualOrder<T extends Pick<SavedItem, "type">>(items: readonly T[]): T[] {
  return [...items.filter((x) => x.type === "proposal"), ...items.filter((x) => x.type === "topic")];
}

/**
 * Çıkarılan satırdan sonra odaklanacak satır (saf): EKRANDAKİ sırada bir sonraki, yoksa bir önceki, liste boşaldıysa null.
 * Sunucu sırası iki türü karışık verir (eklenme zamanı); kart ise Öneriler ve Konular diye gruplu çizer.
 */
export function nextFocusAfterRemove<T extends Pick<SavedItem, "type" | "id">>(items: readonly T[], removed: Pick<SavedItem, "type" | "id">): T | null {
  const key = (x: Pick<SavedItem, "type" | "id">) => `${x.type}:${x.id}`;
  const order = visualOrder(items);
  const i = order.findIndex((x) => key(x) === key(removed));
  const rest = order.filter((x) => key(x) !== key(removed));
  if (i < 0) return rest[0] ?? null;
  return rest[i] ?? rest[i - 1] ?? null;
}

/**
 * Listem satırı: kaydın sayfasına bağlantı (numara, başlık, "<durum> · <zaman> eklendi") + 'Çıkar'. Düğmenin adı numarayı taşır
 * ("Çıkar: #K-12"); başlık aria-describedby ile okunur (başlık 'Kapat' gibi ayrılmış bir parça içerse de ad sözleşmesi bozulmaz).
 */
export function SavedRowItem({
  item,
  titleId,
  onRemove,
  buttonRef,
}: {
  item: SavedItem;
  titleId: string;
  onRemove: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const row = savedRow(item);
  return (
    <li className="saved-item">
      <Link to={row.href} className="saved-link">
        <span className="saved-ref">{row.ref}</span>{" "}
        <span className="saved-title" id={titleId}>
          {row.title}
        </span>{" "}
        <span className="saved-meta">
          {row.status} · <Time at={item.savedAt} /> eklendi
        </span>
      </Link>
      <Button size="sm" variant="ghost" className="saved-remove" ref={buttonRef} aria-describedby={titleId} onClick={onRemove}>
        Çıkar<span className="sr-only">: {row.ref}</span>
      </Button>
    </li>
  );
}

/** 'Kişisel sıralama' tercihi: Listem kartının altında; siyasi görüş rızası yoksa etkisiz olduğu söylenir. */
function PersonalRankingToggle() {
  const auth = useAuth();
  const toast = useToast();
  // İstek sürerken kutu yeni değeri gösterir (iyimser); başarısızlıkta sunucudaki değere döner.
  const [pending, setPending] = useState<boolean | null>(null);
  const me = auth.user;
  if (!me) return null;
  const busy = pending !== null;
  const on = pending ?? me.personalRanking !== false;
  const change = async (value: boolean) => {
    if (busy) return;
    setPending(value);
    try {
      auth.setUser(await updateConsents({ personalRanking: value }));
      toast.success(value ? "Kişisel sıralama açıldı." : "Kişisel sıralama kapatıldı; listeler varsayılan sırada gösterilecek.");
    } catch (e) {
      toast.error(e);
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="saved-ranking">
      <Checkbox
        label={<strong>Kişisel sıralama</strong>}
        checked={on}
        aria-disabled={busy || undefined}
        onChange={(e) => void change(e.target.checked)}
        hint={
          me.politicalConsent
            ? "Açıkken ‘Size göre’ ve ana sayfadaki ‘Şu an açık’; yazdığınız, desteklediğiniz, mesaj yazdığınız ve listenize eklediğiniz önerilerin konularına göre sıralanır. Siyasi görüş rızanıza dayanır; kapalıyken bu kayıtlar sıralama için hiç okunmaz."
            : "Siyasi görüş rızanız olmadığı için kişisel sıralama yapılmaz (öneri, destek ve mesaj kayıtlarınız özel nitelikli veridir); listeler varsayılan sırada gösterilir."
        }
      />
    </div>
  );
}

export function SavedListCard() {
  const auth = useAuth();
  const toast = useToast();
  const userId = auth.user?.id ?? null;
  const { data, error, loading, reload, setData } = useAsync(() => getSaved(), [userId], { enabled: !!userId });
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const base = useId();
  const items = data?.items ?? [];
  const keyOf = (x: SavedItem) => `${x.type}:${x.id}`;
  const titleId = (x: SavedItem) => `${base}-t-${x.type}-${x.id}`;

  const remove = async (item: SavedItem) => {
    try {
      await unsaveItem(item.type, item.id);
    } catch (e) {
      toast.error(e);
      return;
    }
    const rest = items.filter((x) => keyOf(x) !== keyOf(item));
    const next = nextFocusAfterRemove(items, item);
    setData({ items: rest });
    toast.success(`${item.type === "proposal" ? "Öneri" : "Konu"} listenizden çıkarıldı.`);
    // Düğme kalkınca odak belgeye düşmesin: sıradaki satıra (yoksa boş durum satırına) geçer.
    window.setTimeout(() => (next ? buttons.current.get(keyOf(next))?.focus() : emptyRef.current?.focus()), 0);
  };

  const section = (title: string, list: SavedItem[]) =>
    list.length ? (
      <div className="saved-group">
        <h3 className="h3 mt-0 saved-group-title">
          {title} ({formatNumber(list.length)})
        </h3>
        <ul className="saved-list">
          {list.map((item) => (
            <SavedRowItem
              key={keyOf(item)}
              item={item}
              titleId={titleId(item)}
              onRemove={() => void remove(item)}
              buttonRef={(el) => {
                buttons.current.set(keyOf(item), el);
              }}
            />
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <Card
      title="Listem"
      anchor={PROFILE_ANCHORS.listem}
      subtitle="Öneri ve konu sayfalarındaki ‘Listeme ekle’ ile kaydettikleriniz. Yalnız siz görürsünüz; ‘Size göre’ sıralamada da kullanılır."
      summary={data ? savedSummary(items) : undefined}
      actions={
        items.some((x) => x.type === "proposal") ? (
          <Link to={SAVED_PROPOSALS_HREF} className="small">
            Önerilerde göster
          </Link>
        ) : undefined
      }
    >
      {loading && !data ? <Spinner label="Listeniz yükleniyor…" /> : null}
      {error && !data ? <ErrorView error={error} onRetry={() => void reload()} compact /> : null}
      {data && !items.length ? (
        <p className="small muted mt-0" ref={emptyRef} tabIndex={-1}>
          Listeniz boş. Bir öneri ya da konu sayfasındaki ‘☆ Listeme ekle’ düğmesine dokunun.
        </p>
      ) : null}
      {data && items.length ? (
        <div className="stack-sm">
          {section("Öneriler", items.filter((x) => x.type === "proposal"))}
          {section("Konular", items.filter((x) => x.type === "topic"))}
        </div>
      ) : null}
      <PersonalRankingToggle />
    </Card>
  );
}
