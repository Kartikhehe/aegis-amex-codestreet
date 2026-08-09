import { useEffect, useLayoutEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useThemeMode } from 'hooks/useThemeMode';
import AuthProvider from 'providers/AuthProvider';
import { useSettingsContext } from 'providers/SettingsProvider';
import { REFRESH } from 'reducers/SettingsReducer';

/**
 * App shell.
 *
 * Aurora mounted a floating customiser here (nav shape, topnav shape, vibrant
 * colours). AEGIS has one layout on purpose -- the emergency stop must be in
 * the same place on every screen -- so the panel is gone and light/dark lives
 * in the topbar where an operator will actually look for it.
 */
const App = () => {
  const { pathname } = useLocation();
  const { mode } = useThemeMode();
  const { configDispatch } = useSettingsContext();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // Re-resolve chart colours when the mode flips: ECharts reads computed CSS
  // variables once, so it needs a nudge that MUI's own theming does not give.
  useLayoutEffect(() => {
    configDispatch({ type: REFRESH });
  }, [mode, configDispatch]);

  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
};

export default App;
