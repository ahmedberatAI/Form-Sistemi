// 'Keşfet ve doğrula' (/kesfet): sistemin yedi bileşeni tek sayfada, her biri canlı durumuyla ve bir dokunuşla; yedi adımlı
// gösterim rehberi (adımlar mevcut veriden türetilir: son karar, listedeki ilk aykırı öneri, sabit rotalar — pages/kesfet.ts);
// sekiz temel ilkenin tam metni; sözlük (lib/glossary.ts: terim aynen, günlük karşılık, tanım, dayanak madde).
// Gezinme öğesi değildir (üst gezinme 8 öğe kalır): Ana sayfa vitrini ('Gösterim rehberi ›'), masaüstü alt bilgisi ve mobil
// 'Daha fazla' sayfasının 'Keşfet ve doğrula' grubundan gelinir. Hiçbir şey taşınmadı: vitrin ve ilkeler Ana sayfada yerinde durur.
// Derin bağlantı: ?bolum=bilesenler|rehber|ilkeler|sozluk|terim-<kimlik> (lib/sectionParam.ts: açar, kaydırır, odağı taşır).
// Sözlük bölümleri 'Sade' görünümde kapalı, 'Tam' görünümde açık gelir; arama eşleşen bölümlerin hepsini açar.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getDashboard, listProposals } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { PRINCIPLES } from "../components/home/PrinciplesAccordion";
import { normalizeSearch } from "../lib/format";
import { GLOSSARY, glossaryByGroup, searchGlossary, type GlossaryEntry } from "../lib/glossary";
import { listReceipts } from "../lib/receipts";
import { routes } from "../lib/routes";
import { SECTION_PARAM, useSectionParam } from "../lib/sectionParam";
import { useAsync } from "../lib/useAsync";
import { Button, cx, Details, Icon, Input, PageHeader, Spinner, Term } from "../ui";
import { TermBody } from "../ui/Term";
import { evidenceRows, glossaryQueryForTarget, guideSteps, KESFET_SECTIONS, termAnchor, type EvidenceRow, type GuideStep, type KesfetAnchor } from "./kesfet";
import "./kesfet.css";

const SECTION_TITLE = Object.fromEntries(KESFET_SECTIONS.map((s) => [s.anchor, s.title])) as Record<KesfetAnchor, string>;

/**
 * ?bolum= ile gelinince odak: bölümde başlık (ekran okuyucu bölüm adını okur; sonraki Sekme ilk bağlantıya gider), sözlükte
 * terimin adı. Okuma sayfası olduğu için ilk denetime (arama alanı, ilk bağlantı) atlanmaz.
 */
const SECTION_FOCUS: Record<string, string> = {
  ...Object.fromEntries(KESFET_SECTIONS.map((s) => [s.anchor, ".kesfet-section-title"])),
  ...Object.fromEntries(GLOSSARY.map((e) => [termAnchor(e.id), ".kesfet-term-name"])),
};

/** Bölüm: ui/Section ile aynı işaretleme (bölge adı = başlık); başlık programla odaklanabilir (tabIndex −1). */
function KesfetSection({ anchor, title, description, children }: { anchor: KesfetAnchor; title: string; description: string; children: ReactNode }) {
  const hid = useId();
  return (
    <section className="section" id={anchor} aria-labelledby={hid}>
      <div className="section-header">
        <h2 className="section-title kesfet-section-title" id={hid} tabIndex={-1}>
          {title}
        </h2>
      </div>
      <p className="section-description">{description}</p>
      {children}
    </section>
  );
}

/** 'Bu sayfada' kısa yolları: ?bolum= ile (replace) bölüme kaydırır, geçmişi kirletmez. */
function OnThisPageNav() {
  return (
    <nav className="kesfet-onpage" aria-label="Bu sayfada">
      <span className="kesfet-onpage-title" aria-hidden="true">
        Bu sayfada:
      </span>
      <ul className="kesfet-onpage-list">
        {KESFET_SECTIONS.map((s, i) => (
          <li key={s.anchor}>
            {i > 0 ? (
              <span className="kesfet-onpage-sep" aria-hidden="true">
                ·
              </span>
            ) : null}
            <Link to={routes.kesfet({ bolum: s.anchor })} replace>
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Bileşen satırı: üst satır (ad + canlı durum) bağlantıdır; altında bileşenin ne yaptığı tek cümle. */
function EvidenceItem({ row }: { row: EvidenceRow }) {
  const head = (
    <>
      <span className="kesfet-ev-main">
        <span className="kesfet-ev-label">
          <Icon name={row.icon} size={16} />
          {row.label}
        </span>{" "}
        <span className={cx("kesfet-ev-live", row.tone && `is-${row.tone}`, row.ai && "is-ai")}>
          {row.tone === "warning" ? (
            <>
              <span aria-hidden="true">⚠ </span>
              <span className="sr-only">Uyarı: </span>
            </>
          ) : row.tone === "ok" ? (
            <span aria-hidden="true">✔ </span>
          ) : null}
          {row.live}
        </span>
      </span>
      {row.to ? <Icon name="chevronRight" size={16} className="kesfet-ev-go" /> : null}
    </>
  );
  return (
    <div className={cx("kesfet-ev", row.tone === "warning" && "is-warning")}>
      {row.to ? (
        <Link className="kesfet-ev-head" to={row.to}>
          {head}
        </Link>
      ) : (
        <div className="kesfet-ev-head">{head}</div>
      )}
      <p className="kesfet-ev-about">{row.about}</p>
    </div>
  );
}

/** Rehber adımı: başlık, ne görüleceği, tek birincil bağlantı (yöneticide ek demo bağlantısı) ve sözlük terimi. */
function GuideItem({ step }: { step: GuideStep }) {
  return (
    <li className="kesfet-step">
      <div className="kesfet-step-body">
        {/* Adım numarası CSS sayacıyla çizilir ve gizlidir: başlığın adı yalnız metindir; sırayı <ol> verir. */}
        <h3 className="kesfet-step-title">
          <span className="kesfet-step-no" aria-hidden="true" />
          <span>{step.title}</span>
        </h3>
        <p className="kesfet-step-text">{step.text}</p>
        {step.fallback ? <p className="kesfet-step-note">{step.fallback}</p> : null}
        <p className="kesfet-step-links">
          <Link to={step.link.to} className="kesfet-step-link">
            {step.link.label} <Icon name="chevronRight" size={14} />
          </Link>
          {step.extra ? (
            <Link to={step.extra.to} className="kesfet-step-link">
              {step.extra.label} <Icon name="chevronRight" size={14} />
            </Link>
          ) : null}
        </p>
        {step.term ? (
          <p className="kesfet-step-term">
            Sözlükte: <Term id={step.term} />
          </p>
        ) : null}
      </div>
    </li>
  );
}

function GlossaryItem({ entry }: { entry: GlossaryEntry }) {
  return (
    <div className="kesfet-term" id={termAnchor(entry.id)}>
      <dt className="kesfet-term-name" tabIndex={-1}>
        {entry.term}
      </dt>
      <dd className="kesfet-term-body">
        <TermBody entry={entry} />
      </dd>
    </div>
  );
}

/** Sözlük: arama + konu bölümleri (Details). Arama terimde, sembolde, günlük karşılıkta ve tanımda Türkçe duyarsızdır. */
function Glossary() {
  const [q, setQ] = useState("");
  // Aynı sayfadaki 'Sözlükte ›' (rehber adımındaki terim penceresi) süzgecin gizlediği bir terime gidiyorsa arama temizlenir;
  // bu etki sayfanın useSectionParam'ından önce çalışır, hedef terim bir sonraki karede çizilmiş olur.
  const [params] = useSearchParams();
  const target = params.get(SECTION_PARAM);
  useEffect(() => {
    setQ((cur) => glossaryQueryForTarget(target, cur));
  }, [target]);
  const filtering = !!normalizeSearch(q.trim());
  const groups = useMemo(() => glossaryByGroup(filtering ? searchGlossary(q) : GLOSSARY), [q, filtering]);
  const found = groups.reduce((n, g) => n + g.entries.length, 0);
  return (
    <div className="stack">
      <Input
        label="Sözlükte ara"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        hint="Terim, sembol ya da günlük karşılık (ör. köprü, τ, parmak izi)"
        fieldClassName="kesfet-gloss-search"
      />
      <p className="small muted mt-0" role="status">
        {filtering ? (found ? `${found} terim bulundu.` : "Eşleşen terim yok.") : `${GLOSSARY.length} terim, ${groups.length} konu.`}
      </p>
      {groups.length ? (
        <div className="stack-sm">
          {/* Anahtar süzgeç durumunu içerir: arama başlayınca/bitince bölümler kullanıcının önceki açıp kapamasından bağımsız varsayılana döner. */}
          {groups.map(({ group, entries }) => (
            <Details key={`${group.id}|${filtering}`} className="kesfet-gloss-group" summary={group.label} meta={`${entries.length} terim`} open={filtering ? true : undefined}>
              <p className="small muted mt-0">{group.hint}</p>
              <dl className="kesfet-gloss">
                {entries.map((e) => (
                  <GlossaryItem key={e.id} entry={e} />
                ))}
              </dl>
            </Details>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function KesfetPage() {
  const auth = useAuth();
  const userId = auth.user?.id;
  // Oturum yüklenmeden pano istenmez (Ana sayfadaki gibi): önce ziyaretçi verisi gelip sonra üyeninkiyle değişmesin.
  const dash = useAsync(() => getDashboard(), [userId], { enabled: !auth.loading });
  const inadmissible = useAsync(() => listProposals({ status: "inadmissible", limit: 1 }), []);
  const receipts = useAsync(() => listReceipts(), [userId], { enabled: !auth.loading && !!userId });

  const settling = auth.loading || (dash.loading && !dash.data) || (inadmissible.loading && !inadmissible.data);
  // Derin bağlantı veri gelince çalışır: rehber yer tutucusu listeye dönüşürken hedef bölüm kaymasın.
  useSectionParam(!settling, { focus: SECTION_FOCUS });

  const rows = evidenceRows({ system: auth.system, dashboard: dash.data ?? null, receipts: receipts.data?.length ?? null });
  const steps = guideSteps({ latest: dash.data?.recentEnacted[0] ?? null, inadmissible: inadmissible.data?.[0] ?? null, admin: auth.can("A") });
  const failed = !settling && (!!dash.error || !!inadmissible.error);

  return (
    <div className="page kesfet">
      <PageHeader
        title="Keşfet ve doğrula"
        subtitle="Sistemin yedi bileşeni canlı durumuyla, adım adım gösterim rehberi, temel ilkeler ve sözlük; hepsi bir dokunuş ötede."
      />
      <OnThisPageNav />

      <KesfetSection anchor="bilesenler" title={SECTION_TITLE.bilesenler} description="Her satır canlıdır; dokununca ilgili sayfa açılır.">
        <ul className="kesfet-evidence" role="list">
          {rows.map((r) => (
            <li key={r.key}>
              <EvidenceItem row={r} />
            </li>
          ))}
        </ul>
      </KesfetSection>

      <KesfetSection
        anchor="rehber"
        title={SECTION_TITLE.rehber}
        description="Yedi bileşeni sırayla göstermek için yedi adım. Bağlantılar sistemdeki gerçek kayıtlara gider."
      >
        {settling ? (
          <Spinner block label="Rehber hazırlanıyor…" />
        ) : (
          <>
            {failed ? (
              <div className="kesfet-failed" role="status">
                <span>Canlı veriye ulaşılamadı; bağlantılar genel sayfalara gider.</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  onClick={() => {
                    void dash.reload();
                    void inadmissible.reload();
                  }}
                >
                  Yenile
                </Button>
              </div>
            ) : null}
            <ol className="kesfet-steps" role="list">
              {steps.map((s) => (
                <GuideItem key={s.key} step={s} />
              ))}
            </ol>
          </>
        )}
      </KesfetSection>

      <KesfetSection
        anchor="ilkeler"
        title={`${SECTION_TITLE.ilkeler} (${PRINCIPLES.length})`}
        description="Çoğunluğun azınlığı tüketmemesi, azınlığın da kararı süresiz engelleyememesi için tasarlanan kurallar."
      >
        <ol className="kesfet-tenets" role="list">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="kesfet-tenet">
              <h3 className="kesfet-tenet-title">{p.title}</h3>
              <p className="kesfet-tenet-text">{p.text}</p>
              <Link to={p.to} className="kesfet-tenet-link">
                {p.link} <Icon name="chevronRight" size={14} />
              </Link>
            </li>
          ))}
        </ol>
      </KesfetSection>

      <KesfetSection
        anchor="sozluk"
        title={SECTION_TITLE.sozluk}
        description="Yönetmelik terimleri ekranda aynen kalır; burada günlük karşılıklarını ve tanımlarını okuyabilirsiniz."
      >
        <Glossary />
      </KesfetSection>
    </div>
  );
}
