/**
 * Stack defaults.
 *
 * Aurora overrode `direction` to 'row', inverting MUI's documented default of
 * 'column'. That is a trap: every <Stack> written against the standard
 * behaviour silently lays out horizontally, which is what was collapsing the
 * decision-stream rows, the metric tiles and the page headers into single
 * lines of run-together text.
 *
 * `useFlexGap` is kept -- it is a genuine improvement (real gap instead of
 * negative margins) and it changes no layout direction.
 */
const Stack = {
  defaultProps: {
    useFlexGap: true,
  },
};

export default Stack;
