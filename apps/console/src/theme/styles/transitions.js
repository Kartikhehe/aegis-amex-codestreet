const transitions = (theme) => ({
  layout: {
    transition: theme.transitions.create(['width'], {
      duration: theme.transitions.duration.standard,
    }),
  },
});
export default transitions;
