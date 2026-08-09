import {
  stepClasses,
  stepConnectorClasses,
  stepIconClasses,
  stepLabelClasses,
} from '@mui/material';

const Stepper = {
  defaultProps: {},
  styleOverrides: {
    alternativeLabel: () => ({
      [`& .${stepClasses.root}`]: {
        '&:first-of-type': {
          [`& .${stepLabelClasses.root}`]: {
            alignItems: 'flex-start',
            [`& .${stepLabelClasses.label}`]: {
              textAlign: 'left',
            },
          },
        },
        '&:nth-of-type(2)': {
          [`& .${stepConnectorClasses.root}`]: {
            left: 'calc(-95% + 25px)',
          },
        },
        '&:last-of-type': {
          [`& .${stepLabelClasses.root}`]: {
            alignItems: 'flex-end',
            [`& .${stepLabelClasses.label}`]: {
              textAlign: 'right',
            },
          },
          [`& .${stepConnectorClasses.root}`]: {
            right: 'calc(5% + 25px)',
          },
        },
      },
    }),
  },
};

export const Step = {
  defaultProps: {},
  styleOverrides: {},
};

export const StepContent = {
  defaultProps: {},
  styleOverrides: {
    root: ({ theme }) => ({
      borderColor: theme.vars.palette.divider,
    }),
  },
};

export const StepIcon = {
  defaultProps: {},
  styleOverrides: {
    root: ({ theme }) => ({
      color: theme.vars.palette.neutral.lighter,
      [`&.${stepIconClasses.active}`]: {
        color: theme.vars.palette.primary.main,
      },
      [`&.${stepIconClasses.completed}`]: {
        color: theme.vars.palette.success.main,
      },
      [`&:not(.${stepIconClasses.completed}):not(.${stepIconClasses.active}) .${stepIconClasses.text}`]:
        {
          fill: theme.vars.palette.text.primary,
        },
      [`&.${stepIconClasses.text}`]: {
        fill: theme.vars.palette.common.white,
      },
      [`&.${stepIconClasses.error}`]: {
        fill: theme.vars.palette.error.main,
      },
    }),
    text: ({ theme }) => ({
      fontSize: theme.typography.body2.fontSize,
      fontWeight: 500,
    }),
  },
};

export const StepLabel = {
  defaultProps: {},
  styleOverrides: {
    label: ({ theme }) => ({
      [`&, &.${stepLabelClasses.active}, &.${stepLabelClasses.completed}`]: {
        color: theme.vars.palette.text.primary,
        ...theme.typography.subtitle2,
        fontWeight: 700,
      },
      [`&.${stepLabelClasses.error}`]: {
        color: theme.vars.palette.error.main,
      },
    }),
    labelContainer: ({ theme, ownerState }) => ({
      ...(ownerState.orientation === 'vertical' && {
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing(1),
      }),
    }),
    error: ({ theme }) => ({
      color: theme.vars.palette.error.main,
    }),
  },
};

export const StepConnector = {
  defaultProps: {},
  styleOverrides: {
    root: ({ theme }) => ({
      [`&.${stepConnectorClasses.disabled} .${stepConnectorClasses.line}`]: {
        borderColor: theme.vars.palette.divider,
      },
      [`&.${stepConnectorClasses.active} .${stepConnectorClasses.line}`]: {
        borderColor: theme.vars.palette.primary.main,
      },
      [`&.${stepConnectorClasses.completed} .${stepConnectorClasses.line}`]: {
        borderColor: theme.vars.palette.success.main,
      },
    }),
  },
};

export default Stepper;
