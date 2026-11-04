import './generated/tokens.css';
import './styles/shell.css';
import './styles/dialogs.css';
import './styles/history.css';
import './styles/sidebar.css';
import './styles/toolbar.css';
import './styles/tour.css';
import './styles/insights.css';
import './styles/notebook.css';
import './styles/pictures.css';
import './styles/structure.css';
import './styles/outline.css';
import './styles/goals.css';
import './generated/environment.css';
import './styles/environment.css';
import './generated/covenant.css';
import './styles/covenant.css';
import './generated/style.css';
import './generated/preview.css';
import './generated/cover.css';
import './generated/export.css';
import './generated/local.css';
import './generated/print.css';
import './generated/import.css';
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
