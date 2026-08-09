import { MenuItem } from '@mui/material';
import { multiSectionDigitalClockSectionClasses } from '@mui/x-date-pickers';

const MultiSectionDigitalClock = {
  defaultProps: {
    slots: {
      digitalClockSectionItem: ({ sx, ...other }) => (
        <MenuItem
          {...other}
          sx={(theme) => ({
            ...sx,
            m: 0.5,
            p: 0,
            height: 40,
            width: 40,
            justifyContent: 'center',
            borderRadius: 1,

            '&.Mui-selected': {
              bgcolor: theme.vars.palette.primary.main,
              color: theme.vars.palette.primary.contrastText,

              '&:hover': {
                bgcolor: theme.vars.palette.primary.dark,
              },
            },
          })}
        />
      ),
    },
  },
  styleOverrides: {
    root: {
      border: 'none',

      [`& .${multiSectionDigitalClockSectionClasses.root}`]: {
        borderLeft: 'none !important',
      },
    },
  },
};

export default MultiSectionDigitalClock;
