import axiosInstance from './axiosInstance';

const axiosFetcher = async (args, extraArg) => {
  const [url, config, extraConfig] = Array.isArray(args) ? args : [args];
  let interceptors = null;

  interceptors = axiosInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (extraConfig?.disableThrowError) {
        return Promise.resolve(null);
      }
      throw error;
    },
  );

  const res = await axiosInstance({
    url,
    method: config?.method || 'get',
    data: extraArg?.arg,
    ...config,
  }).finally(() => {
    if (interceptors) {
      axiosInstance.interceptors.response.eject(interceptors);
      interceptors = null;
    }
  });

  return res;
};

export default axiosFetcher;
