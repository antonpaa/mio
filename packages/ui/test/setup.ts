import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Without explicit cleanup every render accumulates in one jsdom document,
// and axe then correctly reports duplicate <main> landmarks ACROSS tests.
afterEach(cleanup);
