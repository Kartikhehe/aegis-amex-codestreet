import { createContext, use, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useTheme } from '@mui/material';
import { mainDrawerWidth } from 'lib/constants';
import { useBreakpoints } from 'providers/BreakpointsProvider';
import { useSettingsContext } from 'providers/SettingsProvider';
import { COLLAPSE_NAVBAR, EXPAND_NAVBAR } from 'reducers/SettingsReducer';
import paths from 'routes/paths';

const NavContext = createContext({});

const NavProvider = ({ children }) => {
  const [openItems, setOpenItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [responsievSidenavCollapsed, setResponsiveSidenavCollapsed] = useState(false);
  const { pathname } = useLocation();

  const { currentBreakpoint, down } = useBreakpoints();

  const theme = useTheme();
  const downMd = down('md');

  const {
    config: { sidenavCollapsed, navigationMenuType, topnavType, sidenavType },
    setConfig,
    configDispatch,
  } = useSettingsContext();

  const isNestedItemOpen = (items = []) => {
    if (pathname === paths.comingSoon) {
      return false;
    }
    const checkLink = (children) => {
      if (
        `${children.path}` === pathname ||
        (children.selectionPrefix && pathname.includes(children.selectionPrefix))
      ) {
        return true;
      }

      return children.items && children.items.some(checkLink);
    };

    return items.some(checkLink);
  };

  const sidenavAppbarVariant = useMemo(() => {
    if (navigationMenuType === 'sidenav') {
      return 'appbar';
    }
    if (navigationMenuType === 'combo') {
      switch (topnavType) {
        case 'default': {
          return 'appbar';
        }
        case 'slim': {
          return 'appbarSlim';
        }
        case 'stacked': {
          return downMd ? 'appbar' : 'appbarStacked';
        }
      }
    }
  }, [navigationMenuType, topnavType, downMd]);

  const topbarHeight = useMemo(() => {
    if (navigationMenuType === 'sidenav') {
      return theme.mixins.topbar.default;
    } else {
      return theme.mixins.topbar[topnavType];
    }
  }, [navigationMenuType, topnavType]);

  useEffect(() => {
    if (navigationMenuType === 'sidenav' || navigationMenuType === 'combo') {
      if (sidenavType !== 'slim') {
        if (sidenavCollapsed) {
          configDispatch({
            type: COLLAPSE_NAVBAR,
          });
        }
        if (currentBreakpoint === 'md') {
          configDispatch({
            type: COLLAPSE_NAVBAR,
          });
          setResponsiveSidenavCollapsed(true);
        }
        if (downMd) {
          configDispatch({
            type: EXPAND_NAVBAR,
          });
        }
      } else {
        setConfig({
          drawerWidth: mainDrawerWidth.slim,
        });
      }
      if (currentBreakpoint === 'md') {
        setConfig({
          openNavbarDrawer: false,
        });
      }
    }
    if (!loaded) {
      setLoaded(true);
    }
  }, [currentBreakpoint, navigationMenuType, downMd]);

  useEffect(() => {
    if (currentBreakpoint !== 'md' && responsievSidenavCollapsed) {
      setResponsiveSidenavCollapsed(false);
      configDispatch({
        type: EXPAND_NAVBAR,
      });
    }
  }, [currentBreakpoint]);

  return (
    <NavContext
      value={{
        openItems,
        setOpenItems,
        isNestedItemOpen,
        sidenavAppbarVariant,
        topbarHeight,
        sidenavCollapsed,
      }}
    >
      {loaded && children}
    </NavContext>
  );
};

export const useNavContext = () => use(NavContext);

export default NavProvider;
