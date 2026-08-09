/**
 * Registers the AEGIS mono variants with MUI.
 *
 * Without variantMapping, a custom variant renders as <span> with no styles
 * applied. Mapping each mono variant to a semantic element keeps the DOM
 * meaningful: figures and hashes are <span>, so they can sit inline in a
 * sentence without breaking its flow.
 */
const Typography = {
  defaultProps: {
    variantMapping: {
      subtitle2: 'p',
      mono: 'span',
      monoSmall: 'span',
      monoCaption: 'span',
      monoDisplay: 'div',
      monoHeading: 'div',
    },
  },
};

export default Typography;
