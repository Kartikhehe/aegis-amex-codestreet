import { useEffect, useMemo } from 'react';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { useSettingsContext } from 'providers/SettingsProvider';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

const createRtlCache = () =>
  createCache({
    key: 'aegisrtl',
    stylisPlugins: [prefixer, rtlPlugin],
  });

const createLtrCache = () =>
  createCache({
    key: 'aegis',
  });

const RTLMode = ({ children }) => {
  const {
    config: { textDirection },
  } = useSettingsContext();

  const cache = useMemo(
    () => (textDirection === 'rtl' ? createRtlCache() : createLtrCache()),
    [textDirection],
  );

  useEffect(() => {
    document.dir = textDirection;
  }, [textDirection]);

  return <CacheProvider value={cache}>{children}</CacheProvider>;
};

export default RTLMode;
