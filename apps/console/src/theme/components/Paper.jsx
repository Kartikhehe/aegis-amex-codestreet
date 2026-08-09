import { paperClasses } from '@mui/material';
import { cssVarRgba } from 'lib/utils';
import { blue, grey } from 'theme/palette/colors';

const backgrounds = {
  1: { light: grey[50], dark: grey[900] },
  2: { light: grey[100], dark: grey[800] },
  3: { light: grey[200], dark: grey[700] },
  4: { light: grey[300], dark: grey[600] },
  5: { light: blue[50], dark: blue[950] },
};

const backgroundVariants = Object.keys(backgrounds).map((background) => ({
  props: { background: Number(background) },
  style: ({ theme }) => [
    theme.applyStyles('light', {
      [`&.${paperClasses.root}`]: {
        backgroundColor: backgrounds[Number(background)].light,
      },
    }),
    theme.applyStyles('dark', {
      [`&.${paperClasses.root}`]: {
        backgroundColor: backgrounds[Number(background)].dark,
      },
    }),
  ],
}));

const Paper = {
  variants: [
    {
      props: { variant: 'default' },
      style: ({ theme }) => ({
        border: 'none',
        outline: `1px solid ${theme.vars.palette.divider}`,
        borderRadius: 0,
      }),
    },
    ...backgroundVariants,
  ],
  defaultProps: {
    variant: 'default',
    elevation: 3,
  },
  styleOverrides: {
    /**
     * AEGIS design law: depth comes from layered near-solid surfaces and 1px
     * hairline borders, never from heavy drop shadows. In dark mode a shadow
     * against a #080D1C page reads as smudge, so surfaces are separated by a
     * border and a subtle inset highlight instead.
     */
    elevation: ({ theme }) => ({
      backgroundColor: theme.vars.palette.background.elevation1,
      backgroundImage: 'none',
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: theme.vars.palette.divider,
      ...theme.applyStyles('dark', {
        // A 1px inset top highlight: the surface catches light from above,
        // which reads as raised without a shadow muddying the dark ground.
        boxShadow: `inset 0 1px 0 0 ${cssVarRgba(theme.vars.palette.common.whiteChannel, 0.04)}`,
      }),
    }),
    rounded: {
      borderRadius: 12,
    },
  },
};

export default Paper;
