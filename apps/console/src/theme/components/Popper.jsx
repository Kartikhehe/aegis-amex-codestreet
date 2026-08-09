const Popper = {
  defaultProps: {},
  styleOverrides: {
    root: ({ theme }) => ({
      zIndex: theme.zIndex.tooltip,
    }),
  },
};

export default Popper;
