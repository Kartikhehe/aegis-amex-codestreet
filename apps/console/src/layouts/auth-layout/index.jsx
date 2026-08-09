import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { Stack } from '@mui/material';
import Logo from 'components/common/Logo';
import PageLoader from 'components/loading/PageLoader';

/**
 * The sign-in shell: the mark, then the form. Nothing else.
 */
const AuthLayout = () => (
  <Stack
    sx={{
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      p: 3,
      bgcolor: 'background.default',
    }}
  >
    <Logo />
    <Suspense fallback={<PageLoader sx={{ height: 240 }} />}>
      <Outlet />
    </Suspense>
  </Stack>
);

export default AuthLayout;
