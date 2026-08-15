/**
 * SWR hooks for the AEGIS API.
 *
 * Follows the shape Aurora already uses in services/swr/api-hooks: useSWR with
 * the shared axiosFetcher for reads, useSWRMutation for writes. Reusing that
 * shape means the Bearer interceptor, error normalisation and cache keys all
 * behave exactly as they do elsewhere in the app.
 */
import axiosFetcher from 'services/axios/axiosFetcher';
import useSWR, { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import endpoints from './api';

/** Live surfaces poll; static ones do not. */
const LIVE = { refreshInterval: 5000, revalidateOnFocus: true, keepPreviousData: true };
const STATIC = { revalidateOnFocus: false };

// ---------------------------------------------------------------------------
// Fleet overview
// ---------------------------------------------------------------------------

export const useOverview = (hours = 24, config) =>
  useSWR([endpoints.overview, { params: { hours } }], axiosFetcher, { ...LIVE, ...config });

export const useFleetState = (config) =>
  useSWR([endpoints.fleetState], axiosFetcher, { ...LIVE, ...config });

export const useStopFleet = () =>
  useSWRMutation([endpoints.fleetStop, { method: 'post' }], axiosFetcher);

export const useRearmFleet = () =>
  useSWRMutation([endpoints.fleetRearm, { method: 'post' }], axiosFetcher);

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

// Passing null skips the request entirely -- SWR treats a null key as "not
// ready", which is what a page with nothing selected yet needs.
export const useDecisions = (params = {}, config) =>
  useSWR(params === null ? null : [endpoints.decisions, { params }], axiosFetcher, {
    ...LIVE,
    ...config,
  });

export const useDecision = (actionId, config) =>
  useSWR(actionId ? [endpoints.decision(actionId)] : null, axiosFetcher, {
    ...STATIC,
    ...config,
  });

export const useDecide = () => useSWRMutation([endpoints.decide, { method: 'post' }], axiosFetcher);

export const useResolveStepUp = (actionId) =>
  useSWRMutation(
    actionId ? [endpoints.resolveStepUp(actionId), { method: 'post' }] : null,
    axiosFetcher,
  );

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const useAgents = (params = {}, config) =>
  useSWR([endpoints.agents, { params }], axiosFetcher, { ...STATIC, ...config });

export const useAgent = (agentId, config) =>
  useSWR(agentId ? [endpoints.agent(agentId)] : null, axiosFetcher, { ...STATIC, ...config });

export const useCreateAgent = () =>
  useSWRMutation([endpoints.agents, { method: 'post' }], axiosFetcher);

export const useRevokeAgent = (agentId) =>
  useSWRMutation(
    agentId ? [endpoints.revokeAgent(agentId), { method: 'post' }] : null,
    axiosFetcher,
  );

export const useSuspendAgent = (agentId) =>
  useSWRMutation(
    agentId ? [endpoints.suspendAgent(agentId), { method: 'post' }] : null,
    axiosFetcher,
  );

/**
 * Dry-run a sub-agent mandate against its parent.
 *
 * Deliberately NOT auto-fetching: this runs when the operator asks, so the
 * spawn dialog shows per-dimension rejections in response to an action rather
 * than flickering validation as they type.
 */
export const useCanIssue = (agentId, mandate, enabled = false) =>
  useSWR(
    enabled && agentId ? [endpoints.canIssue(agentId), { params: mandate }] : null,
    axiosFetcher,
    { ...STATIC, shouldRetryOnError: false },
  );

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const useVerify = (range = {}, config) =>
  useSWR([endpoints.verify, { params: range }], axiosFetcher, { ...STATIC, ...config });

export const useLedger = (params = {}, config) =>
  useSWR([endpoints.ledger, { params }], axiosFetcher, { ...STATIC, ...config });

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const usePolicies = (config) =>
  useSWR([endpoints.policies], axiosFetcher, { ...STATIC, ...config });

export const useSimulatePolicy = () =>
  useSWRMutation([endpoints.simulate, { method: 'post' }], axiosFetcher);

export const useCreatePolicy = () =>
  useSWRMutation([endpoints.policy, { method: 'post' }], axiosFetcher);

export const usePromotePolicy = () =>
  useSWRMutation([endpoints.promote, { method: 'post' }], axiosFetcher);

// ---------------------------------------------------------------------------
// Incidents & disputes
// ---------------------------------------------------------------------------

export const useIncidents = (params = {}, config) =>
  useSWR([endpoints.incidents, { params }], axiosFetcher, { ...LIVE, ...config });

export const useDisputes = (config) =>
  useSWR([endpoints.disputes], axiosFetcher, { ...STATIC, ...config });

export const useOpenDispute = () =>
  useSWRMutation([endpoints.disputes, { method: 'post' }], axiosFetcher);

export const useBuildPacket = (disputeId) =>
  useSWRMutation(
    disputeId ? [endpoints.disputePacket(disputeId), { method: 'post' }] : null,
    axiosFetcher,
  );

// ---------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------

export const useMerchants = (config) =>
  useSWR([endpoints.merchants], axiosFetcher, { ...STATIC, ...config });

export const useOperators = (config) =>
  useSWR([endpoints.operators], axiosFetcher, { ...STATIC, ...config });

/**
 * Invalidate every AEGIS query.
 *
 * A fleet stop or a revocation changes the meaning of most of the screen at
 * once, so the honest response is to refetch broadly rather than to guess
 * which panels are still accurate.
 */
export const useRefreshAll = () => {
  const { mutate } = useSWRConfig();
  return () => mutate(() => true, undefined, { revalidate: true });
};
