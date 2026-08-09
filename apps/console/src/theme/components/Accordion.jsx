import {
  accordionClasses,
  accordionDetailsClasses,
  accordionSummaryClasses,
  typographyClasses,
} from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';

const Accordion = {
  defaultProps: {
    elevation: 0,
    disableGutters: true,
  },
  styleOverrides: {
    root: ({ theme }) => ({
      padding: 0,
      outline: 'none',
      borderRadius: '1.5rem !important',

      '&:hover': {
        backgroundColor: theme.vars.palette.background.elevation1,
      },
      '&:before': {
        display: 'none',
      },

      [`&.${accordionClasses.disabled}`]: {
        backgroundColor: 'transparent',

        [`& .${accordionDetailsClasses.root}`]: {
          [`& .${typographyClasses.root}`]: {
            color: theme.vars.palette.text.disabled,
          },
        },
      },
    }),
  },
};

export const AccordionSummary = {
  defaultProps: {
    expandIcon: (
      <IconifyIcon icon="material-symbols:keyboard-arrow-down-rounded" sx={{ fontSize: 24 }} />
    ),
  },
  styleOverrides: {
    root: ({ theme }) => ({
      gap: theme.spacing(1),
      flexDirection: 'row-reverse',
      padding: theme.spacing(3),

      [`& .${accordionSummaryClasses.content}`]: {
        margin: 0,
        fontSize: theme.typography.h5.fontSize,
        fontWeight: 700,
        [`& .${typographyClasses.root}`]: {
          color: theme.vars.palette.text.primary,
          fontSize: theme.typography.subtitle1.fontSize,
          fontWeight: 700,
          lineHeight: 1.5,
        },
      },

      [`& .${accordionSummaryClasses.expandIconWrapper}`]: {
        color: theme.vars.palette.text.primary,
      },

      [`&.${accordionSummaryClasses.disabled}`]: {
        color: theme.vars.palette.text.disabled,

        [`& .${accordionSummaryClasses.expandIconWrapper}`]: {
          color: theme.vars.palette.text.disabled,
        },
      },
    }),
  },
};

export const AccordionDetails = {
  defaultProps: {},
  styleOverrides: {
    root: ({ theme }) => ({
      padding: theme.spacing(0, 3, 3, 7),
      color: theme.vars.palette.text.secondary,

      [`& .${typographyClasses.root}`]: {
        fontWeight: 500,
        color: theme.vars.palette.text.secondary,
      },
    }),
  },
};

export default Accordion;
