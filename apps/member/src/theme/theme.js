import { createTheme as muiCreateTheme } from '@mui/material';
import { blue, green, grey, lightSurface, orange, red } from './palette/colors';
import typography from './typography';

/**
 * The member app's theme.
 *
 * Shares the exact AEGIS palette and JetBrains Mono typography with the
 * console -- the same colors.js and typography.js -- but deliberately not its
 * component overrides. Those exist to make a dense admin console legible; this
 * surface is a phone screen with big type, generous touch targets and no
 * tables, so it needs a smaller and different set of rules.
 *
 * The mode toggle uses the SAME storage key as the console ('aegis-mode'), so
 * a member who chose light mode in one surface gets it in the other.
 */

const hexToRgbChannel = (hex) => {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const int = parseInt(full, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
};

const withChannel = (palette) =>
  Object.entries(palette).reduce(
    (acc, [key, value]) => {
      if (typeof value === 'string' && value.startsWith('#')) {
        acc[`${key}Channel`] = hexToRgbChannel(value);
      }
      return acc;
    },
    { ...palette },
  );

const sharedSemantic = (mode) => ({
  primary: withChannel({
    main: blue[400], //  #006FCF  the one brand blue, both modes
    light: mode === 'dark' ? blue[300] : blue[200],
    dark: mode === 'dark' ? blue[300] : blue[700],
    contrastText: '#FFFFFF',
  }),
  success: withChannel({
    main: mode === 'dark' ? green[300] : green[500],
    light: green[300],
    dark: green[800],
    contrastText: '#FFFFFF',
  }),
  warning: withChannel({
    main: mode === 'dark' ? orange[300] : orange[500],
    light: orange[300],
    dark: orange[800],
    contrastText: '#FFFFFF',
  }),
  error: withChannel({
    main: mode === 'dark' ? red[300] : red[500],
    light: red[300],
    dark: red[800],
    contrastText: '#FFFFFF',
  }),
  info: withChannel({
    main: blue[400],
    light: blue[300],
    dark: blue[700],
    contrastText: '#FFFFFF',
  }),
});

const darkPalette = {
  mode: 'dark',
  ...sharedSemantic('dark'),
  divider: grey[700], //   #182746  border
  text: {
    primary: grey[100], //   #EDF2FB
    secondary: grey[400], // #9FB2CE
    disabled: grey[500], //  #6B7C99
  },
  background: withChannel({
    default: grey[950], //  #080D1C  page
    paper: grey[900], //    #0C1428  card
    inset: grey[800], //    #12233F  inset
    borderHi: grey[600], // #2C4A7C
  }),
  common: withChannel({ white: '#FFFFFF', black: '#000000' }),
};

const lightPalette = {
  mode: 'light',
  ...sharedSemantic('light'),
  divider: lightSurface.border, // #D6DEE8
  text: {
    primary: lightSurface.text, //     #17202A
    secondary: lightSurface.text2, //  #5B6673
    disabled: lightSurface.textMuted, // #8A94A1
  },
  background: withChannel({
    default: lightSurface.page, //  #F4F7FB
    paper: lightSurface.card, //    #FFFFFF
    inset: lightSurface.inset, //   #EAF2FB
    borderHi: lightSurface.borderHi,
  }),
  common: withChannel({ white: '#FFFFFF', black: '#000000' }),
};

export const createTheme = () =>
  muiCreateTheme({
    cssVariables: { colorSchemeSelector: 'data-aegis-color-scheme', cssVarPrefix: 'aegis' },
    colorSchemes: {
      light: { palette: lightPalette },
      dark: { palette: darkPalette },
    },
    typography: {
      ...typography,
      // Phone-first: body copy is a full 17px, because this screen is read at
      // arm's length by someone deciding whether to spend money.
      body1: { ...typography.body1, fontSize: '1.0625rem', lineHeight: 1.55 },
      h5: { ...typography.h5, fontSize: '1.375rem' },
      h6: { ...typography.h6, fontSize: '1.125rem' },
    },
    shape: { borderRadius: 12 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { WebkitFontSmoothing: 'antialiased' },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundImage: 'none',
            borderRadius: 14,
            border: '1px solid',
            borderColor: theme.vars.palette.divider,
            // Same design law as the console: hairline borders and layered
            // near-solids, never heavy shadows in dark mode.
            ...theme.applyStyles('dark', { boxShadow: 'none' }),
          }),
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 12,
            textTransform: 'none',
            fontWeight: 700,
            // 48px: comfortably above the ~44px minimum for a thumb target.
            minHeight: 48,
            fontSize: '1rem',
          },
          sizeLarge: { minHeight: 56, fontSize: '1.0625rem' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 600 },
        },
      },
    },
  });

export default createTheme;
