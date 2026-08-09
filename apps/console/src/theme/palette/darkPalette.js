import { cssVarRgba, generatePaletteChannel } from 'lib/utils';
import {
  basic,
  blue,
  grey as colorGrey,
  green,
  lightBlue,
  orange,
  purple,
  red,
} from 'theme/palette/colors';

const common = generatePaletteChannel({ white: basic.white, black: basic.black });
const grey = generatePaletteChannel(colorGrey);

const neutral = generatePaletteChannel({
  lighter: grey[900],
  light: grey[800],
  main: grey[300],
  dark: grey[200],
  darker: grey[100],
  contrastText: grey[950],
});
const primary = generatePaletteChannel({
  lighter: blue[950],
  light: blue[300], // #4F9BEA  primary-hi (dark)
  main: blue[400], //  #006FCF  the one brand blue
  dark: blue[300], //  #4F9BEA  hover/active lift
  darker: blue[100],
  contrastText: basic.white,
});
const secondary = generatePaletteChannel({
  lighter: purple[950],
  light: purple[700],
  main: purple[400],
  dark: purple[300],
  darker: purple[100],
  contrastText: purple[950],
});
const error = generatePaletteChannel({
  lighter: red[950],
  light: red[600],
  main: red[400],
  dark: red[300],
  darker: red[200],
  contrastText: red[950],
});
const warning = generatePaletteChannel({
  lighter: orange[950],
  light: orange[800],
  main: orange[400],
  dark: orange[300],
  darker: orange[200],
  contrastText: orange[950],
});
const success = generatePaletteChannel({
  lighter: green[950],
  light: green[700],
  main: green[400],
  dark: green[300],
  darker: green[200],
  contrastText: green[950],
});
const info = generatePaletteChannel({
  lighter: lightBlue[950],
  light: lightBlue[700],
  main: lightBlue[400],
  dark: lightBlue[300],
  darker: lightBlue[200],
  contrastText: lightBlue[950],
});

const action = generatePaletteChannel({
  active: grey[500],
  hover: grey[700],
  selected: grey[900],
  disabled: grey[500],
  disabledBackground: grey[700],
  focus: grey[700],
});

const divider = grey[700];
const menuDivider = grey[700];
const dividerLight = grey[800];
const text = generatePaletteChannel({
  primary: grey[100], //   #EDF2FB  text
  secondary: grey[400], // #9FB2CE  text-2
  disabled: grey[500], //  #6B7C99  text-muted
});
const background = generatePaletteChannel({
  default: grey[950], //    #080D1C  page
  paper: grey[900], //      #0C1428  card
  elevation1: grey[900], // #0C1428  card
  elevation2: grey[800], // #12233F  inset
  elevation3: grey[700], // #182746  border
  elevation4: grey[600], // #2C4A7C  border-hi
  menu: grey[900],
  menuElevation1: grey[800],
  menuElevation2: grey[700],
});
const vibrant = {
  listItemHover: cssVarRgba(common.whiteChannel, 0.1),
  buttonHover: cssVarRgba(common.whiteChannel, 0.1),
  textFieldHover: cssVarRgba(common.whiteChannel, 0.1),
  text: {
    secondary: cssVarRgba(common.whiteChannel, 0.7),
    disabled: cssVarRgba(common.whiteChannel, 0.5),
  },
  overlay: cssVarRgba(common.whiteChannel, 0),
};

const chGrey = generatePaletteChannel({
  50: grey[900],
  100: grey[800],
  200: grey[700],
  300: grey[600],
  400: grey[500],
  500: grey[400],
  600: grey[300],
  700: grey[200],
  800: grey[100],
  900: grey[50],
  950: common.white,
});
const chRed = generatePaletteChannel({
  50: red[950],
  100: red[800],
  200: red[700],
  300: red[600],
  400: red[500],
  500: red[400],
  600: red[300],
  700: red[200],
  800: red[100],
  900: red[50],
  950: common.white,
});
const chBlue = generatePaletteChannel({
  50: blue[950],
  100: blue[800],
  200: blue[700],
  300: blue[600],
  400: blue[500],
  500: blue[400],
  600: blue[300],
  700: blue[200],
  800: blue[100],
  900: blue[50],
  950: common.white,
});
const chGreen = generatePaletteChannel({
  50: green[950],
  100: green[800],
  200: green[700],
  300: green[600],
  400: green[500],
  500: green[400],
  600: green[300],
  700: green[200],
  800: green[100],
  900: green[50],
  950: common.white,
});
const chOrange = generatePaletteChannel({
  50: orange[950],
  100: orange[800],
  200: orange[700],
  300: orange[600],
  400: orange[500],
  500: orange[400],
  600: orange[300],
  700: orange[200],
  800: orange[100],
  900: orange[50],
  950: common.white,
});
const chLightBlue = generatePaletteChannel({
  50: lightBlue[950],
  100: lightBlue[800],
  200: lightBlue[700],
  300: lightBlue[600],
  400: lightBlue[500],
  500: lightBlue[400],
  600: lightBlue[300],
  700: lightBlue[200],
  800: lightBlue[100],
  900: lightBlue[50],
  950: common.white,
});

export const darkPalette = {
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
