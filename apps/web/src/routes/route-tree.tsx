import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { Splash } from '../splash.js';

const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Splash,
});

export const routeTree = rootRoute.addChildren([indexRoute]);
