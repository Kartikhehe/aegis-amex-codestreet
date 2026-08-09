const Toolbar = {
  variants: [
    {
      props: { variant: 'appbar' },
      style: ({ theme }) => ({
        minHeight: 64,
        [theme.breakpoints.up('md')]: {
          minHeight: 82,
        },
      }),
    },
    {
      props: { variant: 'appbarSlim' },
      style: () => ({
        minHeight: 38,
      }),
    },
    {
      props: { variant: 'appbarStacked' },
      style: ({ theme }) => ({
        minHeight: 129,
        [theme.breakpoints.up('md')]: {
          minHeight: 103,
        },
      }),
    },
  ],
};

export default Toolbar;
