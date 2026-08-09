import { paperClasses } from '@mui/material';

const Drawer = {
  defaultProps: {
    slotProps: {
      paper: {
        variant: 'elevation',
        elevation: 6,
      },
    },
  },
  styleOverrides: {
    docked: {
      [`& .${paperClasses.root}`]: {
        boxShadow: 'none',
      },
    },
  },
};

export default Drawer;
