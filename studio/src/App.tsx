import './generated/tokens.css';
import './styles/shell.css';
import { Shell } from './shell/Shell';
import { ToastProvider } from './shell/Toasts';

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
