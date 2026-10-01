// Defter modülünün iç tipleri: imzalı işlem, saklanan blok, ağ mesajları.
import type { BlockHeaderView, LedgerTx } from "@forum/shared";

export const GENESIS_HASH = "0".repeat(64);
export const MAX_TXS_PER_BLOCK = 500;
/** Kanonik JSON boyut sınırı (bayt). Büyük BALLOT_REVEAL kayıtlarına yetecek kadar geniş. */
export const MAX_TX_BYTES = 4 * 1024 * 1024;
/** Blok zamanı, doğrulayıcının saatinden en fazla bu kadar ileride olabilir. */
export const MAX_FUTURE_MS = 10 * 60_000;
export const OPERATOR_NOTICE = "Aynı makine (demo)";

export type Fault = "none" | "crash" | "byzantine";
export type VoteType = "prevote" | "precommit";

/** Defter işlemi + yeniden hesaplanabilen özeti. */
export interface SignedTx extends LedgerTx {
  hash: string;
}

export interface StoredBlock {
  header: BlockHeaderView;
  txs: SignedTx[];
}

export interface ValidatorInfo {
  id: string;
  publicKey: string;
}

/** Önerilen değerin gövdesi (tur ve önerenden bağımsız). */
export interface ValueBody {
  prevHash: string;
  time: number;
  txs: SignedTx[];
}

export interface ProposalMsg {
  kind: "proposal";
  height: number;
  round: number;
  /** Tendermint "validRound": değer daha önce hangi turda polka aldıysa (-1: yeni değer) */
  polRound: number;
  proposer: string;
  value: ValueBody;
  sig: string;
}

export interface VoteMsg {
  kind: "vote";
  type: VoteType;
  height: number;
  round: number;
  blockHash: string | null;
  validator: string;
  sig: string;
}

export type NetMessage =
  | { kind: "tx"; tx: SignedTx }
  | ProposalMsg
  | VoteMsg
  | { kind: "status"; height: number; hash: string }
  | { kind: "sync_request"; from: number }
  | { kind: "sync_response"; blocks: StoredBlock[]; tip: number }
  | { kind: "mempool_request" }
  | { kind: "mempool_response"; txs: SignedTx[] };

export interface EvidenceVote {
  blockHash: string | null;
  sig: string;
}

/** Çift imza kanıtı (EVIDENCE işlem yükü). voteA/voteB blockHash'e göre sıralıdır (null önce). */
export interface EvidencePayload {
  validator: string;
  height: number;
  round: number;
  voteA: EvidenceVote;
  voteB: EvidenceVote;
}
