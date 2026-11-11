import { render } from 'preact';
import '../styles.css';
import { KioskView } from './KioskView.jsx';
import { AdminView } from './AdminView.jsx';

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) {
    return <AdminView />;
  }
  return <KioskView />;
}

render(<App />, document.getElementById('app'));
