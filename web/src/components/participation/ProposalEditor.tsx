// Yazarın öneri metnini düzenlemesi (taslak / tartışma / uzlaşma): her kayıt yeni sürüm üretir ve yeniden denetlenir.
import { useState } from "react";
import { PROPOSAL_TEXT_LIMITS as L, type Finding, type ProposalDetail } from "@forum/shared";
import { errorMessage, isApiError } from "../../api/client";
import { updateProposal } from "../../api/endpoints";
import { useOntology } from "../../lib/categories";
import { Alert, Button, Details, DiffView, Input, Textarea, useToast } from "../../ui";
import { piiFromError, PiiNotice, type PiiFinding } from "./common";

export interface ProposalEditorProps {
  proposal: ProposalDetail;
  onSaved: (p: ProposalDetail) => void;
  onCancel: () => void;
  /** Ön doldurulacak metin (ör. YZ taslağı) */
  initialTitle?: string;
  initialBody?: string;
  note?: string;
}

export function ProposalEditor({ proposal: p, onSaved, onCancel, initialTitle, initialBody, note }: ProposalEditorProps) {
  const toast = useToast();
  const { articleLabel } = useOntology();
  const [title, setTitle] = useState(initialTitle ?? p.title);
  const [body, setBody] = useState(initialBody ?? p.body);
  const [saving, setSaving] = useState(false);
  const [pii, setPii] = useState<PiiFinding[] | null>(null);
  const [error, setError] = useState<{ message: string; violations: Finding[] } | null>(null);

  const changed = title.trim() !== p.title || body.trim() !== p.body;
  const valid = title.trim().length >= L.titleMin && title.trim().length <= L.titleMax && body.trim().length >= L.bodyMin;

  const save = async (acknowledgePii = false) => {
    setSaving(true);
    setError(null);
    try {
      const d = await updateProposal(p.id, { title: title.trim(), body: body.trim(), acknowledgePii: acknowledgePii || undefined });
      setPii(null);
      toast.success(`Yeni sürüm (${d.version}) kaydedildi ve deftere yazıldı.`);
      onSaved(d);
    } catch (e) {
      const found = piiFromError(e);
      if (found) setPii(found);
      else {
        const violations = isApiError(e) ? (((e.details as { violations?: Finding[] } | null)?.violations ?? []) as Finding[]) : [];
        setError({ message: errorMessage(e), violations });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="stack-sm proposal-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      {note ? <p className="small muted">{note}</p> : null}
      <Input label="Başlık" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={L.titleMax} required hint={`${L.titleMin}–${L.titleMax} karakter`} />
      <Textarea label="Metin" value={body} onChange={(e) => setBody(e.target.value)} maxLength={L.bodyMax} showCount rows={10} required hint={`En az ${L.bodyMin} karakter. Kayıt yeni sürüm oluşturur; eski sürümler silinmez.`} />
      {changed ? (
        <Details summary="Değişiklikleri önizle">
          <DiffView before={`${p.title}\n\n${p.body}`} after={`${title.trim()}\n\n${body.trim()}`} context={2} label="Güncel metin ile farkı" />
        </Details>
      ) : null}
      {pii ? <PiiNotice findings={pii} loading={saving} onAcknowledge={() => void save(true)} onCancel={() => setPii(null)} ackLabel="Yine de kaydet" /> : null}
      {error ? (
        <Alert tone="error" title="Sürüm kaydedilemedi" onClose={() => setError(null)}>
          <p>{error.message}</p>
          {error.violations.length ? (
            <ul>
              {error.violations.map((v, i) => (
                <li key={i}>
                  {v.message}
                  {v.article ? <span className="muted"> — {v.articleLabel ?? articleLabel(v.article)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Vazgeç
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!changed || !valid || !!pii}>
          Yeni sürümü kaydet
        </Button>
      </div>
    </form>
  );
}
