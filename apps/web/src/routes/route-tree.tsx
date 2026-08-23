import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { Splash } from '@mio/ui';

const rootRoute = createRootRoute({
  component: Outlet,
});

// L0: the launch screen while the session resolves. The login flow replaces
// this as the index in WP-08.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Splash,
});

export const routeTree = rootRoute.addChildren([indexRoute]);
