// Punto de entrada de la ventana.

import { createRoot } from 'react-dom/client';

import { boot } from './actions';
import { App } from './components/App';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

void boot();
