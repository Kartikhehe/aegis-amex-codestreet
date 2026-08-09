import { Box, Button, Link, Stack, Typography } from '@mui/material';
import paths from 'routes/paths';

const LoggedOut = () => {
  return (
    <Stack
      direction="column"
      sx={{
        flex: 1,
        height: 1,
        alignItems: 'center',
        justifyContent: 'space-between',
        p: { xs: 4, md: 10 },
      }}
    >
      <Box sx={{ display: { xs: 'none', md: 'block' } }} />
      <Box sx={{ maxWidth: 370 }}>
        <Typography variant="h4">You have been logged out.</Typography>
        <Typography variant="h2" sx={{ mb: 2 }}>
          See you soon!
        </Typography>
        <Typography sx={{ mb: 6 }}>
          We are sad to see you go away but hey, you can log back in anytime you want!
        </Typography>
        <Button variant="contained" href={paths.defaultJwtLogin} color="primary" fullWidth>
          Log back in
        </Button>
      </Box>
      <Link href="#!" variant="subtitle2">
        Trouble signing in?
      </Link>
    </Stack>
  );
};

export default LoggedOut;
