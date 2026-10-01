import { it } from "vitest";
import { closeVoting, makeBlocks, makeForum, seedHistory, toDeliberation, toVoting } from "../test/forum/harness";
it("dbg", async () => {
  const h = await makeForum();
  const b = makeBlocks(h);
  await seedHistory(h, b, 10);
  const id = await toDeliberation(h, b.A[1], b.all.slice(2), { title: "Park saatleri kısaltılsın", body: "Mahalle parkı gece onda kapatılsın ve bekçi görevlendirilsin; gürültü azaltılsın." });
  await toVoting(h, id);
  for (const u of b.A) await h.forum.proposals.vote(u, id, "yes");
  for (const u of b.B) await h.forum.proposals.vote(u, id, "yes");
  for (const u of b.C) await h.forum.proposals.vote(u, id, "no");
  await closeVoting(h, id);
  let d = h.forum.proposals.get(id, null);
  console.log(d.status, d.phaseEndsAt! - h.ctx.clock.now(), d.events.map(e => [e.from, e.to, e.reason]));
  const t = await h.advance(73);
  d = h.forum.proposals.get(id, null);
  console.log(t, d.status, d.events.map(e => [e.from, e.to, e.reason]));
}, 60000);
