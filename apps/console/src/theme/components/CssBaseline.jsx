import echart from 'theme/styles/echart';
import keyFrames from 'theme/styles/keyFrames';
import notistack from 'theme/styles/notistack';
import popper from 'theme/styles/popper';
import simplebar from 'theme/styles/simplebar';

const CssBaseline = {
  defaultProps: {},
  styleOverrides: (theme) => ({
    '*': {
      scrollbarWidth: 'thin',
    },
    'input:-webkit-autofill': {
      WebkitBoxShadow: `0 0 0px 40rem ${theme.vars.palette.background.elevation2} inset !important`,
      transition: 'background-color 5000s ease-in-out 0s',
    },
    'input:-webkit-autofill:hover': {
      WebkitBoxShadow: `0 0 0px 40rem ${theme.vars.palette.background.elevation3} inset !important`,
    },
    body: {
      scrollbarColor: `${theme.vars.palette.background.elevation4} transparent`,
      [`h1, h2, h3, h4, h5, h6, p`]: {
        margin: 0,
      },
      fontVariantLigatures: 'none',
      [`[id]`]: {
        scrollMarginTop: 82,
      },
    },
    ...simplebar(theme),
    ...notistack(theme),
    ...keyFrames(),
    ...echart(),
    ...popper(theme),
  }),
};

export default CssBaseline;
