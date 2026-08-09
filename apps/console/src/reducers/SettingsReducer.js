import { initialConfig } from 'config';
import { mainDrawerWidth } from 'lib/constants';
import { setItemToStore } from 'lib/utils';

export const SET_CONFIG = 'SET_CONFIG';
export const REFRESH = 'REFRESH';
export const RESET = 'RESET';
export const COLLAPSE_NAVBAR = 'COLLAPSE_NAVBAR';
export const EXPAND_NAVBAR = 'EXPAND_NAVBAR';
export const SET_SIDENAV_SHAPE = 'SET_SIDENAV_SHAPE';
export const SET_NAVIGATION_MENU_TYPE = 'SET_NAVIGATION_MENU_TYPE';
export const SET_NAV_COLOR = 'SET_NAV_COLOR';
export const SET_LOCALE = 'SET_LOCALE';

export const settingsReducer = (state, action) => {
  let updatedState = {};

  switch (action.type) {
    case SET_CONFIG: {
      updatedState = action.payload;
      break;
    }
    case COLLAPSE_NAVBAR: {
      updatedState = {
        sidenavCollapsed: true,
        drawerWidth:
          state.sidenavType === 'stacked'
            ? mainDrawerWidth.stackedNavCollapsed
            : mainDrawerWidth.collapsed,
      };
      break;
    }
    case EXPAND_NAVBAR: {
      updatedState = {
        sidenavCollapsed: false,
        drawerWidth: mainDrawerWidth.full,
      };
      break;
    }
    case SET_LOCALE: {
      updatedState = {
        locale: action.payload,
        textDirection: action.payload === 'ar-SA' ? 'rtl' : 'ltr',
      };
      break;
    }
    case SET_NAVIGATION_MENU_TYPE: {
      switch (action.payload) {
        case 'sidenav': {
          updatedState = {
            navigationMenuType: 'sidenav',
            drawerWidth: mainDrawerWidth.full,
          };
          break;
        }
        case 'topnav': {
          updatedState = {
            navigationMenuType: 'topnav',
            sidenavCollapsed: false,
            drawerWidth: mainDrawerWidth.full,
          };
          break;
        }
        case 'combo': {
          updatedState = {
            navigationMenuType: 'combo',
            sidenavCollapsed: false,
            drawerWidth: mainDrawerWidth.full,
          };
          break;
        }
      }
      break;
    }
    case SET_SIDENAV_SHAPE: {
      switch (action.payload) {
        case 'default': {
          updatedState = {
            sidenavType: 'default',
            sidenavCollapsed: false,
            drawerWidth: mainDrawerWidth.full,
          };
          break;
        }
        case 'slim': {
          updatedState = {
            sidenavType: 'slim',
            sidenavCollapsed: false,
            drawerWidth: mainDrawerWidth.slim,
          };
          break;
        }
        case 'stacked': {
          updatedState = {
            sidenavType: 'stacked',
            sidenavCollapsed: false,
            drawerWidth: mainDrawerWidth.full,
          };
          break;
        }
      }
      break;
    }
    case SET_NAV_COLOR: {
      const { payload } = action;
      updatedState = {
        navColor: payload,
      };
      break;
    }
    case RESET:
      updatedState = {
        ...initialConfig,
      };
      break;
    case REFRESH:
      return {
        ...state,
      };
    default:
      return state;
  }
  Object.keys(updatedState).forEach((key) => {
    if (
      [
        'themeMode',
        'sidenavCollapsed',
        'sidenavType',
        'textDirection',
        'navigationMenuType',
        'topnavType',
        'navColor',
        'locale',
      ].includes(key)
    ) {
      setItemToStore(key, String(updatedState[key]));
    }
  });

  return { ...state, ...updatedState };
};
