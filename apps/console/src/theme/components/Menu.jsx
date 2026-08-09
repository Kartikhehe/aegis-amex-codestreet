import { listItemIconClasses } from '@mui/material';

export const MenuItem = {
  defaultProps: { dense: true },
  styleOverrides: {
    root: ({ theme }) => ({
      '&:hover': {
        backgroundColor: theme.vars.palette.background.menuElevation1,
      },
      padding: '8px 16px',
      [`& .${listItemIconClasses.root}`]: {
        minWidth: 24,
        '& svg': {
          fontSize: 16,
        },
      },
    }),
    dense: {
      padding: '6px 16px',
    },
  },
};
