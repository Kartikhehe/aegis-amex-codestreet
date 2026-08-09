import { toggleButtonClasses } from '@mui/material';
import { cssVarRgba } from 'lib/utils';

const toggleBtnColors = ['primary', 'secondary', 'info', 'success', 'warning', 'error'];

const toggleBtnCustomVariants = toggleBtnColors.map((color) => ({
  props: { color: color },
  style: (style) => {
    const theme = style.theme;
    const paletteColor = theme.vars.palette[color];

    return {
      backgroundColor: 'transparent',
      color: paletteColor.dark,
      '&:hover': {
        backgroundColor: cssVarRgba(paletteColor.mainChannel, 0.15),
      },
      '&.Mui-selected': {
        color: paletteColor.dark,
      },
    };
  },
}));

const toggleBtnGroupCustomVariants = toggleBtnColors.map((color) => ({
  props: { color: color },
  style: (style) => {
    const theme = style.theme;
    const paletteColor = theme.vars.palette[color];

    return {
      [`& .${toggleButtonClasses.root}`]: {
        color: paletteColor.light,
        '&.Mui-selected': {
          color: paletteColor.dark,
          backgroundColor: cssVarRgba(paletteColor.mainChannel, 0.15),
          '&:hover': {
            color: paletteColor.light,
          },
        },
      },
    };
  },
}));

const ToggleButton = {
  variants: [
    ...toggleBtnCustomVariants,
    {
      props: { color: 'standard' },
      style: (style) => {
        const theme = style.theme;

        return {
          backgroundColor: 'transparent',
          color: theme.vars.palette.neutral.dark,
          '&:hover': {
            backgroundColor: theme.vars.palette.background.elevation2,
          },
          '&.Mui-selected': {
            backgroundColor: theme.vars.palette.background.elevation2,
            '&:hover': {
              backgroundColor: theme.vars.palette.background.elevation2,
            },
          },
        };
      },
    },
  ],
  defaultProps: {},
  styleOverrides: {
    root: ({ theme }) => ({
      border: 'none',
      '&.Mui-disabled': {
        border: 'none',
      },
      '&.Mui-selected': {
        '&.Mui-disabled': {
          border: 'none',
          backgroundColor: 'transparent',
          color: theme.vars.palette.text.disabled,
        },
      },
    }),
    sizeSmall: ({ theme }) => ({
      padding: theme.spacing(0.75),
      borderRadius: theme.shape.borderRadius,
      '& .iconify': {
        fontSize: 18,
      },
    }),
    sizeMedium: ({ theme }) => ({
      padding: theme.spacing(1),
      borderRadius: theme.shape.borderRadius * 1.5,
      '& .iconify': {
        fontSize: 20,
      },
    }),
    sizeLarge: ({ theme }) => ({
      padding: theme.spacing(1.125),
      borderRadius: theme.shape.borderRadius * 2,
      '& .iconify': {
        fontSize: 24,
      },
    }),
  },
};

export const ToggleButtonGroup = {
  variants: [
    ...toggleBtnGroupCustomVariants,
    {
      props: { color: 'standard' },
      style: (style) => {
        const theme = style.theme;

        return {
          [`& .${toggleButtonClasses.root}`]: {
            color: theme.vars.palette.text.secondary,
            '&:hover': {
              color: theme.vars.palette.neutral.dark,
            },
            '&.Mui-selected': {
              color: theme.vars.palette.neutral.dark,
            },
            '&.Mui-disabled': {
              color: theme.vars.palette.text.disabled,
            },
          },
        };
      },
    },
  ],
  defaultProps: {
    color: 'standard',
  },
  styleOverrides: {
    root: ({ theme }) => ({
      borderRadius: theme.shape.borderRadius * 2,
      padding: theme.spacing(0.5),
      gap: theme.spacing(0.25),
      width: 'max-content',
      backgroundColor: theme.vars.palette.background.elevation1,
      [`& .${toggleButtonClasses.root}`]: {
        borderRadius: theme.shape.borderRadius,
        border: 'none !important',
        marginLeft: 0,
      },
    }),
  },
};

export default ToggleButton;
