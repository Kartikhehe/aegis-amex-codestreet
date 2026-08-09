import { apiEndpoints } from 'routes/paths';
import axiosFetcher from 'services/axios/axiosFetcher';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

/**
 * Auth hooks against the AEGIS service.
 *
 * Aurora shipped several of these backed by a `dummyFetcher` that resolved
 * fake responses. Those are gone: every hook here talks to the real API, so a
 * password reset either works or reports why, rather than pretending.
 */

export const useGetCurrentUser = (config) =>
  useSWR([apiEndpoints.profile, {}, { disableThrowError: true }], axiosFetcher, {
    suspense: true,
    shouldRetryOnError: false,
    errorRetryCount: 0,
    ...config,
  });

export const useLoginUser = () =>
  useSWRMutation([apiEndpoints.login, { method: 'post' }], axiosFetcher);

export const useLogOutUser = () =>
  useSWRMutation([apiEndpoints.logout, { method: 'post' }], axiosFetcher);
