export const rootPaths = {
  root: '/',
  authRoot: 'authentication',
  authDefaultJwtRoot: 'default/jwt',
  errorRoot: 'error',
};

const paths = {
  // --- AEGIS -------------------------------------------------------------
  aegisFleet: '/fleet',
  aegisAgents: '/agents',
  aegisAgent: (id) => `/agents/${id}`,
  aegisPolicy: '/policy',
  aegisIncidents: '/incidents',

  // --- auth ---------------------------------------------------------------
  defaultJwtLogin: `/${rootPaths.authRoot}/${rootPaths.authDefaultJwtRoot}/login`,
  defaultLoggedOut: `/${rootPaths.authRoot}/default/logged-out`,

  // --- errors -------------------------------------------------------------
  404: `/${rootPaths.errorRoot}/404`,
};

/**
 * API endpoints, kept here so Aurora's existing auth hooks resolve unchanged.
 * The full AEGIS surface lives in src/aegis/api.js.
 */
export const apiEndpoints = {
  login: '/auth/login',
  logout: '/auth/logout',
  profile: '/auth/profile',
  register: '/auth/register',
  forgotPassword: '/auth/forgot-password',
  setPassword: '/auth/set-password',
};

export default paths;
