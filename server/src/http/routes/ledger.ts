// Dağıtık defter: durum, doğrulayıcı anahtarları, bloklar, işlemler, dahil olma kanıtı, zincir doğrulama,
// demo amaçlı kurcalama / onarım / hata enjeksiyonu (yönetici, denetim günlüğüne yazılır).
import type { FastifyInstance } from "fastify";
import {
  CHAIN_ID,
  type BlockListResponse,
  type BlockView,
  type ChainVerification,
  type CommittedTxView,
  type InclusionProof,
  type LedgerStatus,
  type ValidatorKeys,
} from "@forum/shared";
import type { LedgerService } from "../../core/contracts";
import { notFound } from "../../core/errors";
import { requireRole } from "../auth";
import { blocksQuery, faultBody, hashParams, heightParams, nodeQuery, repairBody, tamperBody, txsQuery } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

function requireNode(ledger: LedgerService, nodeId: string | undefined): string | undefined {
  if (nodeId === undefined || nodeId === "") return undefined;
  if (!ledger.status().validators.some((v) => v.id === nodeId)) throw notFound(`Doğrulayıcı düğüm (${nodeId})`);
  return nodeId;
}

export function registerLedgerRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { ledger, audit } = services;

  app.get("/api/ledger/status", async (): Promise<LedgerStatus> => ledger.status());

  app.get("/api/ledger/validators", async (): Promise<ValidatorKeys> => ({
    chainId: CHAIN_ID,
    validators: ledger.status().validators.map((v) => ({ id: v.id, publicKey: v.publicKey })),
    appPublicKey: ledger.appPublicKey,
  }));

  app.get("/api/ledger/blocks", async (req): Promise<BlockListResponse> => {
    const { from, limit } = parseQuery(blocksQuery, req.query);
    const blocks = ledger.listBlocks({ from, limit: limit ?? 20 });
    return {
      blocks: blocks.map((b) => ({
        height: b.height,
        round: b.round,
        hash: b.hash,
        prevHash: b.prevHash,
        time: b.time,
        proposer: b.proposer,
        txRoot: b.txRoot,
        txCount: b.txCount,
        commitSigs: b.commitSigs,
        txTypes: b.txs.map((t) => t.type),
      })),
      height: ledger.latestBlock().height,
    };
  });

  app.get("/api/ledger/blocks/:height", async (req): Promise<BlockView> => {
    const { height } = parseParams(heightParams, req.params);
    const { node } = parseQuery(nodeQuery, req.query);
    const block = ledger.getBlock(height, requireNode(ledger, node));
    if (!block) throw notFound("Blok");
    return block;
  });

  app.get("/api/ledger/txs", async (req): Promise<CommittedTxView[]> => {
    const { type, proposalId, limit } = parseQuery(txsQuery, req.query);
    return ledger.findTxs({ type, proposalId, limit: limit ?? 50 });
  });

  app.get("/api/ledger/txs/:hash", async (req): Promise<CommittedTxView> => {
    const { hash } = parseParams(hashParams, req.params);
    const tx = ledger.getTx(hash);
    if (!tx) throw notFound("İşlem");
    return tx;
  });

  app.get("/api/ledger/proofs/:hash", async (req): Promise<InclusionProof> => {
    const { hash } = parseParams(hashParams, req.params);
    const proof = ledger.proof(hash);
    if (!proof) throw notFound("Dahil olma kanıtı");
    return proof;
  });

  app.get("/api/ledger/verify", async (req): Promise<ChainVerification[]> => {
    const { node } = parseQuery(nodeQuery, req.query);
    return ledger.verifyChain(requireNode(ledger, node));
  });

  app.post("/api/ledger/tamper", async (req): Promise<ChainVerification[]> => {
    const actor = requireRole(req, "admin");
    const { nodeId, height } = parseBody(tamperBody, req.body);
    requireNode(ledger, nodeId);
    ledger.tamper(nodeId, height);
    audit.log(actor.id, "ledger.tamper", nodeId, { height });
    return ledger.verifyChain();
  });

  app.post("/api/ledger/repair", async (req): Promise<ChainVerification> => {
    const actor = requireRole(req, "admin");
    const { nodeId } = parseBody(repairBody, req.body);
    requireNode(ledger, nodeId);
    const res = await ledger.repair(nodeId);
    audit.log(actor.id, "ledger.repair", nodeId, { ok: res.ok, checkedBlocks: res.checkedBlocks });
    return res;
  });

  app.post("/api/ledger/fault", async (req): Promise<LedgerStatus> => {
    const actor = requireRole(req, "admin");
    const { nodeId, fault } = parseBody(faultBody, req.body);
    requireNode(ledger, nodeId);
    ledger.setFault(nodeId, fault);
    audit.log(actor.id, "ledger.fault", nodeId, { fault });
    return ledger.status();
  });
}
