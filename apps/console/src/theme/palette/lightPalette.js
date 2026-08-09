import { alpha } from '@mui/material/styles';
import { cssVarRgba, generatePaletteChannel } from 'lib/utils';
import {
  basic,
  blue,
  grey as colorGrey,
  green,
  lightBlue,
  lightSurface,
  orange,
  purple,
  red,
} from 'theme/palette/colors';

const common = generatePaletteChannel({ white: basic.white, black: basic.black });
const grey = generatePaletteChannel(colorGrey);

const primary = generatePaletteChannel({
  lighter: blue[50],
  light: blue[300],
  main: blue[400], //  #006FCF  the one brand blue
  dark: blue[700], //  #0F4C9E  primary-hi (light)
  darker: blue[900],
});
const secondary = generatePaletteChannel({
  lighter: purple[50],
  light: purple[300],
  main: purple[500],
  dark: purple[700],
  darker: purple[900],
});
const error = generatePaletteChannel({
  lighter: red[50],
  light: red[300],
  main: red[500],
  dark: red[600],
  darker: red[900],
});
const warning = generatePaletteChannel({
  lighter: orange[50],
  light: orange[400],
  main: orange[500],
  dark: orange[700],
  darker: orange[900],
  contrastText: common.white,
});
const success = generatePaletteChannel({
  lighter: green[50],
  light: green[400],
  main: green[500],
  dark: green[700],
  darker: green[900],
});
const info = generatePaletteChannel({
  lighter: lightBlue[50],
  light: lightBlue[300],
  main: lightBlue[500],
  dark: lightBlue[700],
  darker: lightBlue[900],
  contrastText: common.white,
});
const neutral = generatePaletteChannel({
  lighter: grey[100],
  light: grey[600],
  main: grey[800],
  dark: grey[900],
  darker: grey[950],
  contrastText: common.white,
});

const action = generatePaletteChannel({
  active: grey[500],
  hover: grey[100],
  selected: grey[100],
  disabled: grey[400],
  disabledBackground: grey[200],
  focus: grey[300],
});
// AEGIS light mode is specified independently of dark mode -- it is a parity
// treatment for projectors and accessibility, not an inversion. These read the
// named lightSurface values directly rather than stepping the shared ramp.
const divider = lightSurface.border;
const menuDivider = cssVarRgba(grey['700Channel'], 0);
const dividerLight = cssVarRgba(grey['300Channel'], 0.6);
const text = generatePaletteChannel({
  primary: lightSurface.text, //      #17202A
  secondary: lightSurface.text2, //   #5B6673
  disabled: lightSurface.textMuted, // #8A94A1
});
const background = generatePaletteChannel({
  default: lightSurface.page, //   #F4F7FB  page
  paper: lightSurface.card, //     #FFFFFF  card
  elevation1: lightSurface.card, // #FFFFFF  card
  elevation2: lightSurface.inset, // #EAF2FB  inset
  elevation3: lightSurface.border, // #D6DEE8  border
  elevation4: lightSurface.borderHi, // #B5D4F4  border-hi
  menu: lightSurface.card,
  menuElevation1: lightSurface.page,
  menuElevation2: lightSurface.inset,
});
const vibrant = {
  listItemHover: cssVarRgba(common.whiteChannel, 0.5),
  buttonHover: cssVarRgba(common.whiteChannel, 0.7),
  textFieldHover: cssVarRgba(common.whiteChannel, 0.7),
  text: {
    secondary: alpha('#1B150F', 0.76),
    disabled: alpha('#1B150F', 0.4),
  },
  overlay: cssVarRgba(common.whiteChannel, 0.7),
};
const chGrey = grey;
const chRed = generatePaletteChannel(red);
const chBlue = generatePaletteChannel(blue);
const chGreen = generatePaletteChannel(green);
const chOrange = generatePaletteChannel(orange);
const chLightBlue = generatePaletteChannel(lightBlue);

export const lightPalette = {
  common,
  grey,
  primary,
  secondary,
  error,
  warning,
  success,
  info,
  neutral,
  action,
  divider,
  dividerLight,
  menuDivider,
  text,
  background,
  vibrant,
  chGrey,
  chRed,
  chBlue,
  chGreen,
  chOrange,
  chLightBlue,
};
