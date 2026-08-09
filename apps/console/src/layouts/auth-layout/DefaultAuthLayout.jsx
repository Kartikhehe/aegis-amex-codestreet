import { Box } from '@mui/material';

/**
 * Wrapper for the sign-in screen.
 *
 * Aurora used this slot to let a visitor switch between JWT, Auth0 and
 * Firebase demo providers. AEGIS authenticates one way -- JWT against its own
 * service -- so the switcher is gone and this is a plain container.
 */
const DefaultAuthLayout = ({ children }) => (
  <Box sx={{ width: '100%', maxWidth: 480, mx: 'auto' }}>{children}</Box>
);

export default DefaultAuthLayout;
