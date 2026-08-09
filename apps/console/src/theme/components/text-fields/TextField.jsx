const TextField = {
  defaultProps: {
    variant: 'filled',
  },
  styleOverrides: {
    root: {
      '& input::-webkit-contacts-auto-fill-button, & input::-webkit-credentials-auto-fill-button': {
        visibility: 'hidden',
        display: 'none !important',
        pointerEvents: 'none',
        position: 'absolute',
        right: 0,
      },
    },
  },
};

export default TextField;
