import { alertClasses } from '@mui/material';
import { capitalize } from 'lib/utils';
import IconifyIcon from 'components/base/IconifyIcon';

const Alert = {
  defaultProps: {
    iconMapping: {
      error: <IconifyIcon icon="material-symbols:error-outline-rounded" />,
      success: <IconifyIcon icon="material-symbols:check-circle-outline-rounded" />,
      warning: <IconifyIcon icon="material-symbols:warning-outline-rounded" />,
      info: <IconifyIcon icon="material-symbols:info-outline-rounded" />,
      primary: <IconifyIcon icon="material-symbols:notifications-outline-rounded" />,
      neutral: <IconifyIcon icon="material-symbols:help-outline-rounded" />,
    },
  },
  styleOverrides: {
    root: ({ theme }) => ({
      variants: [
        {
          props: (props) => {
            const { variant } = props;

            return variant === 'standard';
          },
          style: ({ severity, color, theme }) => {
            const paletteColor = theme.vars.palette[color || severity];

            return {
              [`&.${alertClasses.standard}${capitalize(color || severity || '')}`]: {
                backgroundColor: paletteColor.lighter,
                color: paletteColor.darker,
                [`& .${alertClasses.icon}`]: {
                  color: paletteColor.main,
                },
              },
            };
          },
        },
        {
          props: { variant: 'filled' },
          style: ({ severity, theme }) => {
            const paletteColor = theme.vars.palette[severity];

            return {
              [`&.${alertClasses.filled}${capitalize(severity || '')}`]: {
                backgroundColor: paletteColor.main,
                color: paletteColor.contrastText,
                [`& .${alertClasses.icon}`]: {
                  color: paletteColor.contrastText,
                },
              },
            };
          },
        },
        {
          props: { variant: 'outlined' },
          style: ({ severity, theme }) => {
            const paletteColor = theme.vars.palette[severity];

            return {
              [`&.${alertClasses.outlined}${capitalize(severity || '')}`]: {
                borderColor: paletteColor.main,
                color: paletteColor.main,
                [`& .${alertClasses.icon}`]: {
                  color: paletteColor.main,
                },
              },
            };
          },
        },
      ],
      borderRadius: theme.shape.borderRadius * 2,
      outline: 0,
    }),
    message: () => ({
      fontSize: '1rem',
      fontWeight: 500,
    }),
    icon: ({ theme }) => ({
      marginTop: theme.spacing(0.35),
    }),
  },
};

export default Alert;
