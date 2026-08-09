export default {
  lineClamp: {
    style: (props) => ({
      display: '-webkit-box',
      WebkitLineClamp: String(props.lineClamp),
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    }),
  },
};
