// Yapay zekâ modülü: Claude (yapılandırılmış çıktı, sunucu tarafı ret yedeği) + çevrimdışı sezgisel mod.
export { createAiService, type AiServiceOptions, type AiServiceExt, type LintOptions } from "./service";
export { createAiRecordSink, getAnalysis, listAnalyses, approveAnalysis, aiHashes } from "./sink";
export { PROMPT_VERSION, FALLBACK_BETA, DEFAULT_TIMEOUT_MS, LINT_KINDS, type AnthropicLike } from "./claude";
export { detectPii, redactPii, sanitizeForModel, maskValue, PseudonymMasker, PII_PLACEHOLDER } from "./pii";
export { explainDecision } from "./heuristics";
export { detectRights, type RightFinding } from "./rights";
