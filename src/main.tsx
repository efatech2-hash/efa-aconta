import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { VoiceProvider } from './lib/VoiceContext';
import { defineCustomElements } from '@ionic/pwa-elements/loader';

// Initialise les éléments PWA nécessaires à @capacitor/camera sur le web (pwa-camera-modal, pwa-action-sheet)
if (typeof window !== 'undefined') {
  defineCustomElements(window);
}

createRoot(document.getElementById('root')!).render(
  <VoiceProvider>
    <App />
  </VoiceProvider>
);
