// Azınlık itirazı ("alarm zili", ALGORITMA §6): itiraz formu (yalnız canObject) ve geçerlilik değerlendirmesi.
// 'Eylem önce': hak sahibi için 'İtiraz imzala' formu panelin en üstündedir; ardından rozet satırı ve toplam gelir.
// Grup tablosu ve (a)(b)(güçlü) kuralları 'Geçerlilik nasıl hesaplanır?' açılırındadır; sonuçlanmış önerilerde imza listesi
// 'İtiraz imzaları (n)' açılırına girer (açık evrelerde liste görünür ve tam kalır).
import { useState } from "react";
import { clusterLabel, type ObjectionEvaluation, type ObjectionInfo, type ProposalDetail } from "@forum/shared";
import { submitObjection } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { formatNumber } from "../../lib/format";
import { useAction } from "../../lib/useAsync";
import { Alert, Badge, Button, Card, CLOSED_STATUSES, Countdown, Details, Select, Table, Textarea, Time } from "../../ui";
import { UserLink } from "../UserLink";
import { PlainText, SubHeading, Tick } from "./common";
import "./panels.css";

/** Panelin amacını açıklayan cümle (kart altyazısı ve açılırın ilk paragrafı). */
export const OBJECTION_INTRO = "Kabul çıkan karar, ilk turda Red diyenlerin geçerli itirazıyla bir kez durdurulup uzlaşma turuna gönderilebilir.";

/** Geçerlilik kuralları (a), (b) ve 'güçlü itiraz'; (b)'deki sayı değerlendirme yoksa yazılmaz. */
export function objectionRules(crossClusterRequired?: number | null): string[] {
  const total = crossClusterRequired != null ? `Toplam imzacı ≥ ${formatNumber(crossClusterRequired)} (uygun seçmenlerin %10'u)` : "Toplam imzacı uygun seçmenlerin %10'undan az olmamalı";
  return [
    "(a) Tek bir anlamlı grupta imzacı sayısı ≥ max(3, ⌈0,75 · N_g⌉) — N_g o grubun Red oyu sayısıdır.",
    `(b) ${total} ve en az iki farklı görüş grubundan.`,
    "İmzacılar ilgili grubun tüm üyelerinin en az 2/3'ü ise “güçlü itiraz” sayılır: yeniden oylama eşiği en az 2/3 olur.",
  ];
}

/**
 * Değerlendirme hükmü: rozet satırı, toplam geçerli imza ve sunucunun açıklama cümlesi. Rozet bütçesi: satırdaki tek renkli
 * rozet geçerlilik hükmüdür; hangi kuralın sağlandığı (sınıflandırma) ve 'Güçlü itiraz' (bilgi) gri rozettir.
 */
export function ObjectionVerdict({ evaluation: ev }: { evaluation: ObjectionEvaluation }) {
  return (
    <div className="stack-sm objection-verdict">
      <div className="row">
        <Badge tone={ev.valid ? "warning" : "neutral"} icon={ev.valid ? "warning" : "info"}>
          {ev.valid ? "İtiraz geçerli — uzlaşma turu" : "İtiraz henüz geçerli değil"}
        </Badge>
        {ev.rule ? <Badge tone="neutral">{ev.rule === "cluster" ? "Küme kuralı (a)" : "Çapraz küme kuralı (b)"}</Badge> : null}
        {ev.strong ? <Badge tone="neutral">Güçlü itiraz</Badge> : null}
        <span className="small muted">Toplam geçerli imza: {formatNumber(ev.signers)}</span>
      </div>
      <p className="small">{ev.explanation}</p>
    </div>
  );
}

/** 'Geçerlilik nasıl hesaplanır?': panelin amacı, görüş gruplarına göre imza tablosu ve geçerlilik kuralları. */
export function ObjectionRulesDetails({ evaluation: ev }: { evaluation?: ObjectionEvaluation | null }) {
  return (
    <Details summary="Geçerlilik nasıl hesaplanır?" className="panel-details">
      <div className="stack-sm">
        <p className="small">{OBJECTION_INTRO}</p>
        {ev?.perCluster.length ? (
          <Table
            caption="Görüş gruplarına göre itiraz imzaları"
            rowKey={(c) => c.clusterId}
            rows={ev.perCluster}
            columns={[
              { key: "g", header: "Grup", render: (c) => clusterLabel(c.clusterId) },
              { key: "s", header: "İmza", align: "right", render: (c) => formatNumber(c.signers) },
              { key: "n", header: "Red oyu (N_g)", align: "right", render: (c) => formatNumber(c.noVoters) },
              { key: "r", header: "Gerekli", align: "right", render: (c) => `≥ ${c.required}` },
              { key: "ok", header: "Sağlandı mı?", align: "center", render: (c) => <Tick ok={c.signers >= c.required && c.signers > 0} /> },
            ]}
          />
        ) : null}
        <ul className="small rule-list">
          {objectionRules(ev?.crossClusterRequired).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </Details>
  );
}

/** Hüküm + kurallar bir arada (eski kullanım için korunur; panel iki parçayı ayrı ayrı yerleştirir). */
export function ObjectionEvaluationView({ evaluation }: { evaluation: ObjectionEvaluation }) {
  return (
    <div className="stack-sm">
      <ObjectionVerdict evaluation={evaluation} />
      <ObjectionRulesDetails evaluation={evaluation} />
    </div>
  );
}

export function ObjectionList({ objections }: { objections: ObjectionInfo[] }) {
  const { groundLabel } = useOntology();
  const auth = useAuth();
  if (!objections.length) return <p className="small muted">Henüz itiraz imzası yok.</p>;
  return (
    <ul className="list">
      {objections.map((o) => (
        <li key={o.id} className="list-item stack-sm">
          <div className="row small">
            {o.userId && auth.user?.id === o.userId ? (
              <span>
                <UserLink id={o.userId} nickname={o.nickname} /> <span className="muted">(sizin imzanız; başkalarına anonim görünür)</span>
              </span>
            ) : (
              <span className="muted">{o.nickname || "Anonim imzacı"}</span>
            )}
            <span className="muted">{clusterLabel(o.clusterId)}</span>
            <Badge tone="warning">{groundLabel(o.ground)}</Badge>
            <Time at={o.at} className="muted" />
          </div>
          <PlainText text={o.statement} />
        </li>
      ))}
    </ul>
  );
}

export interface ObjectionPanelProps {
  proposal: ProposalDetail;
  onUpdated: (p: ProposalDetail) => void;
}

export function ObjectionPanel({ proposal: p, onUpdated }: ObjectionPanelProps) {
  const auth = useAuth();
  const { ontology, groundLabel } = useOntology();
  const [ground, setGround] = useState("");
  const [statement, setStatement] = useState("");
  const grounds = ontology?.objectionGrounds ?? [];
  const selected = grounds.find((g) => g.iri === ground);

  const send = useAction(() => submitObjection(p.id, { ground, statement: statement.trim() }), {
    success: "İtirazınız imzalandı ve deftere kaydedildi.",
    onSuccess: (d) => {
      setStatement("");
      setGround("");
      onUpdated(d);
    },
  });

  const open = p.status === "objection_window";
  const formFirst = open && !!p.canObject;
  // Karar kesinleştiyse (kabul, ret, aykırı, geri çekildi, süresi doldu) imzalar açılırda durur; uzlaşma/yeniden oylamada liste görünür.
  const settled = CLOSED_STATUSES.includes(p.status);

  const form = (
    <form
      className="stack-sm objection-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run();
      }}
    >
      <SubHeading>İtiraz imzala</SubHeading>
      <Select
        label="Gerekçe"
        placeholder="Yönetmelikteki itiraz gerekçelerinden birini seçin…"
        required
        value={ground}
        onChange={(e) => setGround(e.target.value)}
        options={grounds.map((g) => ({ value: g.iri, label: g.label }))}
        hint={selected?.description}
      />
      <Textarea
        label="Açıklama"
        hint="20–2000 karakter. Kararın neden yeniden düşünülmesi gerektiğini somut olarak yazın; kişisel veri paylaşmayın."
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
        maxLength={2000}
        showCount
        rows={4}
        required
      />
      <Alert tone="info">İmzanız anonim; son 30 günde en çok 2 itiraz imzalayabilirsiniz.</Alert>
      <div className="form-actions">
        <Button type="submit" variant="danger" loading={send.loading} disabled={!ground || statement.trim().length < 20}>
          İtirazı imzala
        </Button>
      </div>
      <Details summary="İtiraz hakkı nasıl işler?" className="panel-details">
        <div className="stack-sm">
          <p className="small">
            İmzanız anonim gösterilir; yalnızca sayısı ve kümesi görünür. Her üye son 30 günde en çok <strong>2</strong> itiraz imzalayabilir.
          </p>
          <p className="small">Bir öneri yalnızca bir kez itiraza uğrayabilir; azınlığın gücü erteleyicidir, kalıcı engel değildir.</p>
        </div>
      </Details>
    </form>
  );

  const note = !open ? null : p.canObject ? null : auth.user ? (
    <p className="small muted">
      Yalnızca ilk turda etkin oyu “Red” olan (vekâletle dahil) uygun seçmenler, süre içinde ve bir kez itiraz edebilir. {auth.can("VV") ? "" : "Oy verebilir üye olmanız gerekir."}
    </p>
  ) : (
    <p className="small muted">İtiraz etmek için giriş yapın.</p>
  );

  const reasons = p.objections.length ? <p className="small muted">Gerekçeler: {[...new Set(p.objections.map((o) => groundLabel(o.ground)))].join(", ")}</p> : null;

  return (
    <Card
      title="Azınlık itirazı (alarm zili)"
      actions={open ? <Countdown to={p.phaseEndsAt} prefix="İtiraz süresi" /> : null}
      tone="warning"
      className="objection-panel"
    >
      <div className="stack">
        {formFirst ? form : null}
        {p.objectionEvaluation ? <ObjectionVerdict evaluation={p.objectionEvaluation} /> : null}
        {note}
        <ObjectionRulesDetails evaluation={p.objectionEvaluation} />

        {settled ? (
          <Details summary={`İtiraz imzaları (${p.objections.length})`} className="panel-details">
            <div className="stack-sm">
              <ObjectionList objections={p.objections} />
              {reasons}
            </div>
          </Details>
        ) : (
          <>
            <SubHeading>İtiraz imzaları ({p.objections.length})</SubHeading>
            <ObjectionList objections={p.objections} />
            {reasons}
          </>
        )}
      </div>
    </Card>
  );
}
