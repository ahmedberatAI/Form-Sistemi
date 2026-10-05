// Forum çekirdeği: öneriler, yaşam döngüsü, konular, tartışma, görüş kümeleri, topluluk.
import type { ForumDeps, ForumServices, LifecycleEngine } from "../core/forum-contracts";
import { createClusterService } from "./clusters";
import { createCommunityService } from "./community";
import { createLifecycle } from "./lifecycle";
import { createMessageService } from "./messages";
import { createProposalService } from "./proposals";
import { createTopicService } from "./topics";
import { ForumCore } from "./util";

export function createForumServices(deps: ForumDeps): ForumServices {
  const core = new ForumCore(deps);
  const clusters = createClusterService(core);
  const topics = createTopicService(core);
  const messages = createMessageService(core);
  const lifecycle: LifecycleEngine = createLifecycle(core, { clusters, topics, messages });
  const proposals = createProposalService(core, { clusters, messages, lifecycle: () => lifecycle });
  const community = createCommunityService(core);
  return { proposals, topics, messages, clusters, community, lifecycle };
}

export { ForumCore } from "./util";
export { applyTransition, auditInputFor, StaleState } from "./lifecycle";
export { scopeOrderFor } from "./tally";
export { INTEGRITY_LOCKSTEP_ACTION } from "./integrity";
