import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Companion } from './companion/Companion';
import { installKeys } from './lib/nav';
import { isCompanion } from './lib/store';
import './styles.css';
import './companion/companion.css';

if (isCompanion) {
  document.documentElement.classList.add('phone');
} else {
  installKeys();
}

createRoot(document.getElementById('root')!).render(isCompanion ? <Companion /> : <App />);
