import { Suspense, lazy } from 'react';
import { Navigate, Outlet, createBrowserRouter } from 'react-router';
import AuthLayout from 'layouts/auth-layout';
import DefaultAuthLayout from 'layouts/auth-layout/DefaultAuthLayout';
import MainLayout from 'layouts/main-layout';
import paths, { rootPaths } from './paths';

const App = lazy(() => import('App'));
const PageLoader = lazy(() => import('components/loading/PageLoader'));

// --- AEGIS screens ---------------------------------------------------------
const FleetOverview = lazy(() => import('pages/aegis/FleetOverview'));
const Agents = lazy(() => import('pages/aegis/Agents'));
const PolicyStudio = lazy(() => import('pages/aegis/PolicyStudio'));
const Incidents = lazy(() => import('pages/aegis/Incidents'));

// --- Auth ------------------------------------------------------------------
const Login = lazy(() => import('pages/authentication/default/jwt/Login'));
const LoggedOut = lazy(() => import('pages/authentication/default/LoggedOut'));
const Page404 = lazy(() => import('pages/errors/Page404'));

const SuspenseOutlet = () => (
  <Suspense fallback={<PageLoader />}>
    <Outlet />
  </Suspense>
);

const router = createBrowserRouter(
  [
    {
      element: (
        <Suspense fallback={<PageLoader sx={{ height: '100vh' }} />}>
          <App />
        </Suspense>
      ),
      children: [
        // --- the console -----------------------------------------------
        {
          path: '/',
          element: (
            // AuthGuard is intentionally left commented so the demo opens
            // straight onto the fleet. Uncomment to require a sign-in.
            // <AuthGuard>
            <MainLayout>
              <SuspenseOutlet />
            </MainLayout>
            // </AuthGuard>
          ),
          children: [
            { index: true, element: <Navigate to={paths.aegisFleet} replace /> },
            { path: paths.aegisFleet, element: <FleetOverview /> },
            { path: paths.aegisAgents, element: <Agents /> },
            { path: paths.aegisPolicy, element: <PolicyStudio /> },
            { path: paths.aegisIncidents, element: <Incidents /> },
          ],
        },

        // --- authentication --------------------------------------------
        {
          path: rootPaths.authRoot,
          element: (
            <AuthLayout>
              <SuspenseOutlet />
            </AuthLayout>
          ),
          children: [
            {
              path: rootPaths.authDefaultJwtRoot,
              element: (
                <DefaultAuthLayout>
                  <SuspenseOutlet />
                </DefaultAuthLayout>
              ),
              children: [{ path: 'login', element: <Login /> }],
            },
            { path: 'default/logged-out', element: <LoggedOut /> },
          ],
        },

        { path: '*', element: <Page404 /> },
      ],
    },
  ],
  { basename: import.meta.env.VITE_BASENAME || '/' },
);

export default router;
