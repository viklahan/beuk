import './generated/tokens.css';
import './styles/shell.css';
import './styles/dialogs.css';
import './styles/history.css';
import { BookProvider } from './book/BookProvider';
import { DialogStackProvider } from './shell/Dialog';
import { Shell } from './shell/Shell';
import { TipsHost } from './shell/TipsHost';
import { ToastProvider } from './shell/Toasts';

export function App() {
  return (
    <ToastProvider>
      <DialogStackProvider>
        <TipsHost />
        <BookProvider>
          <Shell />
        </BookProvider>
      </DialogStackProvider>
    </ToastProvider>
  );
}
