import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../src/App';

describe('the app', () => {
  it('renders its root element', () => {
    const { container } = render(<App />);
    expect(container.querySelector('#app')).not.toBeNull();
  });
});
