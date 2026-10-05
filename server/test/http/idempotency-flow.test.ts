// Idempotency-Key gerçek bileşim köküyle (bulgu #275): bağlantı koptuktan sonra aynı anahtarla yeniden gönderilen öneri ve
// mesaj ikinci kez kaydedilmez (tartışma kayıtları silinemediği için çift kayıt kalıcı olurdu).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fy, type MessageView, type ProposalDetail, type ProposalSummary } from "@forum/shared";
import { HOUR } from "../../src/core/clock";
import { boot, type Harness } from "./harness";

const TIMEOUT = 60_000;
let h: Harness;
let author: { token: string };
let reader: { token: string };

beforeAll(async () => {
  h = await boot();
  author = await h.member("yazar");
  reader = await h.member("okur");
  h.clock.advance(HOUR);
}, TIMEOUT);
afterAll(async () => {
  await h?.close();
});

const keyed = (token: string, key: string) => ({ token, headers: { "idempotency-key": key } });

describe("Idempotency-Key: öneri ve mesaj", () => {
  it("aynı anahtarla yeniden gönderilen öneri tek kez oluşturulur", async () => {
    const title = "Kütüphane çalışma saatlerinin uzatılması";
    const body = { kind: "topic", title, body: "Sınav dönemlerinde mahalle kütüphanesi gece yarısına kadar açık kalsın.", categories: [fy("YesilAlan")], submit: true };
    const first = await h.req("POST", "/api/proposals", { ...keyed(author.token, "c0ffee00-0000-4000-8000-000000000001"), body });
    expect(first.statusCode).toBe(200);
    const again = await h.req("POST", "/api/proposals", { ...keyed(author.token, "c0ffee00-0000-4000-8000-000000000001"), body });
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json<ProposalDetail>().id).toBe(first.json<ProposalDetail>().id);

    const mine = await h.ok<ProposalSummary[]>("GET", "/api/proposals?mine=1", { token: author.token });
    expect(mine.filter((p) => p.title === title)).toHaveLength(1);
  }, TIMEOUT);

  it("aynı anahtarla yeniden gönderilen mesaj tek kez yayımlanır; farklı gövde 422", async () => {
    const proposal = await h.ok<ProposalDetail>("POST", "/api/proposals", {
      token: author.token,
      body: { kind: "topic", title: "Bisiklet yolu ağı", body: "Okullara giden ana caddelere korumalı bisiklet yolu yapılsın.", categories: [fy("YesilAlan")], submit: true },
    });
    const url = `/api/threads/proposal/${proposal.id}`;
    const msg = { body: "Okul yolunda güvenlik için çok gerekli.", stance: "pro" };
    const key = "c0ffee00-0000-4000-8000-000000000002";
    const first = await h.req("POST", url, { ...keyed(reader.token, key), body: msg });
    expect(first.statusCode).toBe(200);
    const again = await h.req("POST", url, { ...keyed(reader.token, key), body: msg });
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json<MessageView>().id).toBe(first.json<MessageView>().id);

    const changed = await h.req("POST", url, { ...keyed(reader.token, key), body: { ...msg, body: "Başka bir metin." } });
    expect(changed.statusCode).toBe(422);
    expect(changed.json().error.code).toBe("idempotency_key_reused");

    const thread = await h.ok<{ messages: MessageView[] }>("GET", url);
    expect(thread.messages.filter((m) => m.body === msg.body)).toHaveLength(1);

    // Anahtarsız (ya da yeni anahtarlı) bilinçli ikinci gönderim yine yayımlanır.
    await h.ok("POST", url, { token: reader.token, body: msg });
    expect((await h.ok<{ messages: MessageView[] }>("GET", url)).messages.filter((m) => m.body === msg.body)).toHaveLength(2);
  }, TIMEOUT);
});
