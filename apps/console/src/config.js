import { mainDrawerWidth } from 'lib/constants';

export const initialConfig = {
  assetsDir: import.meta.env.VITE_ASSET_BASE_URL ?? '',
  textDirection: 'ltr',
  navigationMenuType: 'sidenav',
  sidenavType: 'default',
  sidenavCollapsed: false,
  topnavType: 'default',
  navColor: 'default',
  openNavbarDrawer: false,
  drawerWidth: mainDrawerWidth.full,
  locale: 'en-US',
};

export const defaultJwtAuthCredentials = {
  email: 'operator@aegis.test',
  password: 'password123',
};
