import './generated/tokens.css';
import './styles/shell.css';
import './styles/dialogs.css';
import './styles/history.css';
import './styles/sidebar.css';
import './styles/toolbar.css';
import './styles/tour.css';
import './styles/insights.css';
import { BookProvider } from './book/BookProvider';
import { StatsProvider } from './book/stats';
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
          <StatsProvider>
            <Shell />
          </StatsProvider>
        </BookProvider>
      </DialogStackProvider>
    </ToastProvider>
  );
}
