import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Splash } from '@mio/ui';

describe('launch screen', () => {
  it('renders the design-system splash (L0)', () => {
    render(<Splash />);
    expect(screen.getByText('mio')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });
});
