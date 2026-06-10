/** Root: hash routing (#/ → library, #/doc/:id → editor) + theme toggle. */
import { useEffect, useState } from 'react';
import { Library } from './components/DocumentList/Library';
import { EditorScreen } from './screens/EditorScreen';
import { Icon } from './components/shared/Icon';
import { Tip } from './components/shared/Tip';

const THEME_KEY = 'pdfeditor.theme';

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const m = hash.match(/^#\/doc\/(.+)$/);
  return { name: m ? ('editor' as const) : ('library' as const), docId: m ? decodeURIComponent(m[1]) : null };
}

function navigate(id: string | null) {
  window.location.hash = id ? `#/doc/${encodeURIComponent(id)}` : '#/';
}

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === 'dark');
  const route = useRoute();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  const themeToggle = (
    <Tip label={dark ? 'Light mode' : 'Dark mode'} pos="bottom">
      <button className="iconbtn" onClick={() => setDark(!dark)} aria-label="Toggle theme">
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
    </Tip>
  );

  return route.name === 'editor' && route.docId ? (
    <EditorScreen key={route.docId} docId={route.docId} navigate={navigate} />
  ) : (
    <Library navigate={navigate} themeToggle={themeToggle} />
  );
}
