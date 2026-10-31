import './generated/tokens.css';
import './styles/shell.css';
import { BookProvider } from './book/BookProvider';
import { Shell } from './shell/Shell';
import { ToastProvider } from './shell/Toasts';

export function App() {
  return (
    <ToastProvider>
      <BookProvider>
        <Shell />
      </BookProvider>
    </ToastProvider>
  );
}
