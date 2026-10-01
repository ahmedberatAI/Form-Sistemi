// Azınlık itirazı ("alarm zili", ALGORITMA §6): itiraz formu (yalnız canObject) ve geçerlilik değerlendirmesi.
import { useState } from "react";
import { clusterLabel, type ObjectionEvaluation, type ObjectionInfo, type ProposalDetail } from "@forum/shared";
import { submitObjection } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { formatNumber } from "../../lib/format";
import { useAction } from "../../lib/useAsync";
import { Alert, Badge, Button, Card, Countdown, Select, Table, Textarea, Time } from "../../ui";
import { UserLink } from "../UserLink";
import { PlainText, SubHeading, Tick } from "./common";

export function ObjectionEvaluationView({ evaluation: ev }: { evaluation: ObjectionEvaluation }) {
  return (
    <div className="stack-sm">
      <div className="row">
        <Badge tone={ev.valid ? "warning" : "neutral"} icon={ev.valid ? "warning" : "info"}>
          {ev.valid ? "İtiraz geçerli — uzlaşma turu" : "İtiraz henüz geçerli değil"}
        </Badge>
        {ev.rule ? <Badge tone="info">{ev.rule === "cluster" ? "Küme kuralı (a)" : "Çapraz küme kuralı (b)"}</Badge> : null}
        {ev.strong ? <Badge tone="danger">Güçlü itiraz</Badge> : null}
        <span className="small muted">Toplam geçerli imza: {formatNumber(ev.signers)}</span>
      </div>
      <p className="small">{ev.explanation}</p>
      {ev.perCluster.length ? (
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
        <li>(a) Tek bir anlamlı grupta imzacı sayısı ≥ max(3, ⌈0,75 · N_g⌉) — N_g o grubun Red oyu sayısıdır.</li>
        <li>(b) Toplam imzacı ≥ {formatNumber(ev.crossClusterRequired)} (uygun seçmenlerin %10'u) ve en az iki farklı görüş grubundan.</li>
        <li>İmzacılar ilgili grubun tüm üyelerinin en az 2/3'ü ise “güçlü itiraz” sayılır: yeniden oylama eşiği en az 2/3 olur.</li>
      </ul>
    </div>
  );
}

export function ObjectionList({ objections }: { objections: ObjectionInfo[] }) {
  const { groundLabel } = useOntology();
  if (!objections.length) return <p className="small muted">Henüz itiraz imzası yok.</p>;
  return (
    <ul className="list">
      {objections.map((o) => (
        <li key={o.id} className="list-item stack-sm">
          <div className="row small">
            <UserLink id={o.userId} nickname={o.nickname} />
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

  return (
    <Card
      title="Azınlık itirazı (alarm zili)"
      subtitle="Kabul çıkan karar, ilk turda Red diyenlerin geçerli itirazıyla bir kez durdurulup uzlaşma turuna gönderilebilir."
      actions={open ? <Countdown to={p.phaseEndsAt} prefix="İtiraz süresi" /> : null}
      tone="warning"
    >
      <div className="stack">
        {p.objectionEvaluation ? <ObjectionEvaluationView evaluation={p.objectionEvaluation} /> : null}

        {open && p.canObject ? (
          <form
            className="stack-sm"
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
            <Alert tone="info">
              Her üye son 30 günde en çok <strong>2</strong> itiraz imzalayabilir. Bir öneri yalnızca bir kez itiraza uğrayabilir; azınlığın gücü erteleyicidir, kalıcı
              engel değildir.
            </Alert>
            <div className="form-actions">
              <Button type="submit" variant="danger" loading={send.loading} disabled={!ground || statement.trim().length < 20}>
                İtirazı imzala
              </Button>
            </div>
          </form>
        ) : open && auth.user ? (
          <p className="small muted">
            Yalnızca ilk turda etkin oyu “Red” olan (vekâletle dahil) uygun seçmenler, süre içinde ve bir kez itiraz edebilir. {auth.can("VV") ? "" : "Oy verebilir üye olmanız gerekir."}
          </p>
        ) : open ? (
          <p className="small muted">İtiraz etmek için giriş yapın.</p>
        ) : null}

        <SubHeading>İtiraz imzaları ({p.objections.length})</SubHeading>
        <ObjectionList objections={p.objections} />
        {p.objections.length ? <p className="small muted">Gerekçeler: {[...new Set(p.objections.map((o) => groundLabel(o.ground)))].join(", ")}</p> : null}
      </div>
    </Card>
  );
}
