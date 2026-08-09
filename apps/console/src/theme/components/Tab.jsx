import { svgIconClasses } from '@mui/material';

export const Tab = {
  defaultProps: {},
  styleOverrides: {
    root: {
      padding: '8px',
      minHeight: '36px',
      minWidth: '36px',
      [`.${svgIconClasses.root}`]: {
        fontSize: 20,
      },
    },
  },
};

export const Tabs = {
  defaultProps: {},
  styleOverrides: {
    root: {
      minHeight: '36px',
    },
    list: {
      gap: '8px',
    },
  },
};
