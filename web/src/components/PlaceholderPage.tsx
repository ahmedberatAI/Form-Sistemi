// Yer tutucu sayfa: henüz arayüzü olmayan bir bölüm için "hazırlanıyor" içeriği. Şu an hiçbir yol bunu kullanmıyor (bütün sayfaların
// kendi arayüzü var); yeni bir bölüm sayfadan önce yolu açılırsa geçici içerik olarak kullanılabilir.
import type { ReactNode } from "react";
import { EmptyState, LinkButton, PageHeader } from "../ui";

export function PlaceholderPage({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page">
      <PageHeader title={title} />
      <EmptyState title="Bu sayfa hazırlanıyor" icon="clock" action={<LinkButton to="/">Ana sayfaya dön</LinkButton>}>
        {description ?? <p>Bu bölümün arayüzü yakında eklenecek.</p>}
      </EmptyState>
      {children}
    </div>
  );
}

export default PlaceholderPage;
