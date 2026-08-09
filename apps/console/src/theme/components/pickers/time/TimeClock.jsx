import { IconButton } from '@mui/material';
import { clockClasses, clockPointerClasses } from '@mui/x-date-pickers';
import { cssVarRgba } from 'lib/utils';
import IconifyIcon from 'components/base/IconifyIcon';

const TimeClock = {
  defaultProps: {
    slots: {
      nextIconButton: (props) => (
        <IconButton {...props}>
          <IconifyIcon icon="material-symbols:chevron-right-rounded" sx={{ fontSize: 20 }} />
        </IconButton>
      ),
      previousIconButton: (props) => (
        <IconButton {...props}>
          <IconifyIcon icon="material-symbols:chevron-left-rounded" sx={{ fontSize: 20 }} />
        </IconButton>
      ),
    },
  },
  styleOverrides: {
    root: ({ theme }) => ({
      [`& .${clockClasses.root}`]: {
        margin: 0,
        padding: theme.spacing(3, 0, 3, 0),
        [`& .${clockClasses.clock}`]: {
          background: theme.vars.palette.background.elevation1,
          margin: 0,

          [`& .${clockPointerClasses.root}`]: {
            background: cssVarRgba(theme.vars.palette.primary.mainChannel, 0.15),
          },
        },
      },
    }),
  },
};

export default TimeClock;
