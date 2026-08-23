import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Splash } from './splash.js';

describe('splash', () => {
  it('renders the wordmark and slogan', () => {
    render(<Splash />);
    expect(screen.getByRole('heading', { name: 'mio' })).toBeDefined();
    expect(screen.getByText('Care, together.')).toBeDefined();
  });
});
