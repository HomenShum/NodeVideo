import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { Landing } from './landing';

const root = document.getElementById('root');
if (!root) throw new Error('NodeVideo landing root is missing.');

hydrateRoot(
  root,
  <StrictMode>
    <Landing />
  </StrictMode>,
);
