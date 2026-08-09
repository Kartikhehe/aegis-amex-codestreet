/**
 * AEGIS colour ramps.
 *
 * These ramps are the single source of every colour in the product. The
 * semantic slots in darkPalette.js / lightPalette.js read from here, and all
 * 43 MUI component overrides read from those slots -- so the exact AEGIS
 * values below propagate everywhere without touching a component.
 *
 * The AEGIS specification names one colour per role per mode. A MUI palette
 * needs a ramp, so each specified value is pinned to the step the palette
 * actually reads, and the neighbouring steps are interpolated around it:
 *
 *   grey[950] #080D1C  page background (dark)
 *   grey[900] #0C1428  card            (dark)
 *   grey[800] #12233F  inset           (dark)
 *   grey[700] #182746  border          (dark)
 *   grey[600] #2C4A7C  border-hi       (dark)
 *   grey[100] #EDF2FB  text            (dark)
 *   grey[400] #9FB2CE  text-2          (dark)
 *   grey[500] #6B7C99  text-muted      (both)
 *
 *   blue[400]  #006FCF  primary        (both modes -- one brand blue)
 *   blue[300]  #4F9BEA  primary-hi     (dark)
 *   blue[700]  #0F4C9E  primary-hi     (light)
 *
 * Light mode reads the low steps for surfaces and the high steps for text,
 * which is why the ramps must stay monotonic in luminance across their range.
 */

export const grey = {
  50: '#FFFFFF', //  light: card
  100: '#EDF2FB', //  dark: text          | light: inset-adjacent
  200: '#DDE6F3',
  300: '#B5C4DC',
  400: '#9FB2CE', //  dark: text-2
  500: '#6B7C99', //  text-muted (both modes)
  600: '#2C4A7C', //  dark: border-hi
  700: '#182746', //  dark: border
  800: '#12233F', //  dark: inset
  900: '#0C1428', //  dark: card
  950: '#080D1C', //  dark: page
};

/**
 * Light-mode surface/line values, kept separate from the dark ramp because the
 * two modes are specified independently rather than as inversions.
 *   page #F4F7FB  card #FFFFFF  inset #EAF2FB  border #D6DEE8  border-hi #B5D4F4
 *   text #17202A  text-2 #5B6673  text-muted #8A94A1
 */
export const lightSurface = {
  page: '#F4F7FB',
  card: '#FFFFFF',
  inset: '#EAF2FB',
  border: '#D6DEE8',
  borderHi: '#B5D4F4',
  text: '#17202A',
  text2: '#5B6673',
  textMuted: '#8A94A1',
};

export const blue = {
  50: '#EAF3FD',
  100: '#CCE3F8',
  200: '#9DC8F2',
  300: '#4F9BEA', // primary-hi (dark)
  400: '#006FCF', // PRIMARY -- the one brand blue, both modes
  500: '#0063B8',
  600: '#0057A1',
  700: '#0F4C9E', // primary-hi (light)
  800: '#0A3A78',
  900: '#082C5C',
  950: '#061F42',
};

/**
 * Success -- verdict ALLOW.
 *   dark:  #57C08A on #12261A, border #1E4230
 *   light: #0E7C54
 */
export const green = {
  50: '#E6F5EC',
  100: '#C5E9D6',
  200: '#9BD9B9',
  300: '#57C08A', // dark: ALLOW text/icon
  400: '#2FA871',
  500: '#0E7C54', // light: ALLOW
  600: '#0C6B49',
  700: '#0A583C',
  800: '#1E4230', // dark: ALLOW chip border
  900: '#163322',
  950: '#12261A', // dark: ALLOW chip background
};

/**
 * Warning -- verdict STEP_UP.
 *   dark:  #E0A64C on #241B0A, border #443311
 *   light: #B36A00
 */
export const orange = {
  50: '#FDF3E3',
  100: '#F9E3C0',
  200: '#F2CE93',
  300: '#E0A64C', // dark: STEP_UP text/icon
  400: '#CE8F2E',
  500: '#B36A00', // light: STEP_UP
  600: '#985A00',
  700: '#6E4208',
  800: '#443311', // dark: STEP_UP chip border
  900: '#32250C',
  950: '#241B0A', // dark: STEP_UP chip background
};

/**
 * Danger -- verdict DENY.
 *   dark:  #F0817E on #2A0E12, border #5A1620
 *   light: #C0102E
 */
export const red = {
  50: '#FCEAEC',
  100: '#F8CCCF',
  200: '#F4A9A8',
  300: '#F0817E', // dark: DENY text/icon
  400: '#E05553',
  500: '#C0102E', // light: DENY
  600: '#A20D27',
  700: '#7C1020',
  800: '#5A1620', // dark: DENY chip border
  900: '#3D1119',
  950: '#2A0E12', // dark: DENY chip background
};

/**
 * Secondary. AEGIS specifies no decorative palette -- semantic colour is
 * reserved for verdicts -- so secondary is a restrained slate that reads as
 * structure rather than as a status.
 */
export const purple = {
  50: '#EFF2F8',
  100: '#DCE3F0',
  200: '#BAC6DE',
  300: '#8E9FC4',
  400: '#6B7FAA',
  500: '#526491',
  600: '#42517A',
  700: '#354165',
  800: '#28324F',
  900: '#1D2539',
  950: '#131926',
};

/**
 * Info -- used for permitted-scope chips ("what it may do") on the member
 * surface, deliberately tied to the brand blue rather than a separate hue.
 */
export const lightBlue = {
  50: '#E8F2FC',
  100: '#CBE2F8',
  200: '#A3CCF2',
  300: '#6FAEEC',
  400: '#4F9BEA',
  500: '#2C7FD4',
  600: '#1E6ABB',
  700: '#175597',
  800: '#123F70',
  900: '#0D2E52',
  950: '#0A2038',
};

export const basic = {
  white: '#ffffff',
  black: '#000000',
};

/** Verdict tokens, so components never hand-pick a ramp step. */
export const verdictColors = {
  dark: {
    ALLOW: { fg: green[300], bg: green[950], border: green[800] },
    STEP_UP: { fg: orange[300], bg: orange[950], border: orange[800] },
    DENY: { fg: red[300], bg: red[950], border: red[800] },
    HOLD: { fg: grey[400], bg: grey[800], border: grey[600] },
  },
  light: {
    ALLOW: { fg: green[500], bg: '#E6F5EC', border: '#9BD9B9' },
    STEP_UP: { fg: orange[500], bg: '#FDF3E3', border: '#F2CE93' },
    DENY: { fg: red[500], bg: '#FCEAEC', border: '#F4A9A8' },
    HOLD: { fg: lightSurface.text2, bg: lightSurface.inset, border: lightSurface.border },
  },
};
