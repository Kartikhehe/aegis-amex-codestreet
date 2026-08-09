/**
 * AEGIS API surface.
 *
 * Reuses Aurora's existing axios instance (Bearer interceptor, VITE_API_URL)
 * and its SWR configuration, so authentication and error handling behave the
 * same everywhere in the app.
 *
 * Endpoint paths mirror the service's OpenAPI spec exactly. `npm run
 * generate:api` regenerates `endpoints.generated.json` from the running
 * service's /openapi.json and the check below fails loudly if this file has
 * drifted from it -- the two cannot silently disagree.
 */

export const endpoints = {
  // auth
  login: '/auth/login',
  profile: '/auth/profile',
  logout: '/auth/logout',

  // decisions
  decide: '/decide',
  decisions: '/decisions',
  decision: (actionId) => `/decisions/${actionId}`,
  resolveStepUp: (actionId) => `/decisions/${actionId}/resolve`,

  // agents
  agents: '/agents',
  agent: (agentId) => `/agents/${agentId}`,
  revokeAgent: (agentId) => `/agents/${agentId}/revoke`,
  suspendAgent: (agentId) => `/agents/${agentId}/suspend`,
  canIssue: (agentId) => `/agents/${agentId}/can-issue`,

  // ledger
  verify: '/verify',
  ledger: '/ledger',

  // policy
  policies: '/policies',
  policy: '/policy',
  simulate: '/policy/simulate',
  promote: '/policy/promote',

  // incidents & disputes
  incidents: '/incidents',
  disputes: '/disputes',
  disputePacket: (disputeId) => `/disputes/${disputeId}/packet`,

  // fleet
  fleetState: '/fleet/state',
  fleetStop: '/fleet/stop',
  fleetRearm: '/fleet/rearm',
  overview: '/overview',

  // reference
  merchants: '/merchants',
  operators: '/operators',

  // demo (only mounted when AEGIS_ENABLE_DEMO=true)
  demoTamper: '/demo/tamper',
  demoRestore: '/demo/restore',
};

export default endpoints;
