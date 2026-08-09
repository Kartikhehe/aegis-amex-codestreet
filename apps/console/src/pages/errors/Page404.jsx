import { Link } from 'react-router';
import { Box, Button, Stack, Typography } from '@mui/material';
import paths from 'routes/paths';

/**
 * 404.
 *
 * Aurora shipped this with two Lottie animations embedded as JSON -- 452 kB of
 * bundle for a page nobody should ever reach. A governance console does not
 * need a cartoon here; it needs to say what happened and get the operator back
 * to the fleet.
 */
const Page404 = () => (
  <Stack
    sx={{
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      gap: 2,
      p: 3,
      bgcolor: 'background.default',
    }}
  >
    <Typography variant="monoDisplay" sx={{ color: 'text.disabled', fontSize: '4rem' }}>
      404
    </Typography>
    <Typography variant="h5" sx={{ fontWeight: 700 }}>
      There is nothing at this address
    </Typography>
    <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 420 }}>
      The page you asked for does not exist. It may have been renamed, or the link that brought you
      here may be out of date.
    </Typography>
    <Box sx={{ mt: 1 }}>
      <Button component={Link} to={paths.aegisFleet} variant="contained">
        Back to fleet overview
      </Button>
    </Box>
  </Stack>
);

export default Page404;
