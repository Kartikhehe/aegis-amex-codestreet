import { Link as RouterLink } from 'react-router';

export const LinkBehavior = ({ ref, ...props }) => {
  const { href, ...other } = props;

  return <RouterLink ref={ref} to={href} {...other} />;
};
LinkBehavior.displayName = 'LinkBehavior';

const Link = {
  defaultProps: {
    component: LinkBehavior,
    underline: 'hover',
  },
  styleOverrides: {
    underlineHover: () => ({
      position: 'relative',
      backgroundImage: `linear-gradient(currentcolor, currentcolor)`,
      backgroundSize: '0% 1px',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'left bottom',
      transition: 'background-size 0.25s ease-in',
      '&:hover': {
        textDecoration: 'none',
        backgroundSize: '100% 1px',
      },
    }),
  },
};

export default Link;
