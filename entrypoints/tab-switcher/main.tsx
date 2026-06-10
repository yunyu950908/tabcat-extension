import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TabSwitcher from './TabSwitcher';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TabSwitcher />
  </StrictMode>,
);
