import { Drawer, drawerClasses } from '@mui/material';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import FleetHaltBanner from 'aegis/components/FleetHaltBanner';
import AppBar from 'layouts/main-layout/app-bar';
import Sidenav from 'layouts/main-layout/sidenav';
import { mainDrawerWidth } from 'lib/constants';
import { useSettingsContext } from 'providers/SettingsProvider';
import NavProvider from './NavProvider';
import SidenavDrawerContent from './sidenav/SidenavDrawerContent';

/**
 * The console shell.
 *
 * One layout, deliberately. Aurora offered topnav, combo and three sidenav
 * shapes; AEGIS pins a single sidebar because the emergency stop lives in its
 * footer and must be in the same place on every screen. A layout mode that can
 * hide the stop is not a mode this product can offer.
 *
 * The sidebar still collapses (full -> icon rail -> mobile drawer), which is
 * what the responsive requirement actually asks for.
 */
const MainLayout = ({ children }) => {
  const {
    config: { drawerWidth, openNavbarDrawer },
    setConfig,
  } = useSettingsContext();

  const toggleNavbarDrawer = () => setConfig({ openNavbarDrawer: !openNavbarDrawer });

  return (
    <Box>
      {/* Dims the console and slides down when the fleet is halted. */}
      <FleetHaltBanner />

      <Box sx={{ display: 'flex', zIndex: 1, position: 'relative' }}>
        <NavProvider>
          <AppBar />
          <Sidenav />

          <Drawer
            variant="temporary"
            open={openNavbarDrawer}
            onClose={toggleNavbarDrawer}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: 'block', md: 'none' },
              [`& .${drawerClasses.paper}`]: {
                pt: 3,
                boxSizing: 'border-box',
                width: mainDrawerWidth.full,
              },
            }}
          >
            <SidenavDrawerContent variant="temporary" />
          </Drawer>

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              minHeight: '100vh',
              width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` },
              ml: { md: `${mainDrawerWidth.collapsed}px`, lg: 0 },
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.default',
            }}
          >
            <Toolbar variant="appbar" />
            <Box sx={{ flex: 1, p: { xs: 2, md: 3 }, minWidth: 0 }}>{children}</Box>
          </Box>
        </NavProvider>
      </Box>
    </Box>
  );
};

export default MainLayout;
