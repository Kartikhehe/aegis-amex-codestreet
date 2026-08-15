import axios from 'axios';

/**
 * The simulator's API client.
 *
 * It talks to the same service as the console and the member app, with the
 * same JWT. There is no simulator-only backdoor: a checkout here goes through
 * POST /simulate/checkout, which calls the same decide() that a real
 * integration would, so a verdict seen here is a verdict the product would
 * genuinely have produced.
 */

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('aegis_sim_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) =>
    Promise.reject({
      status: error.response?.status,
      data: error.response?.data,
    }),
);

export const endpoints = {
  login: '/auth/login',
  profile: '/auth/profile',
  operators: '/operators',
  agents: '/agents',
  storefronts: '/storefronts',
  assistants: '/simulate/assistants',
  checkout: '/simulate/checkout',
  decision: (actionId) => `/decisions/${actionId}`,
};

export default api;
