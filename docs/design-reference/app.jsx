/* app.jsx — root: routing, theme, tweaks, mount */
const AppCtx = React.createContext(null);

function ThemeToggle() {
  const { dark, setDark } = React.useContext(AppCtx);
  return (
    <Tip label={dark ? 'Light mode' : 'Dark mode'} pos="bottom">
      <button className="iconbtn" onClick={() => setDark(!dark)} aria-label="Toggle theme">
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
    </Tip>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#4f46e5",
  "dark": false,
  "font": "Inter",
  "density": "regular",
  "libView": "grid",
  "toolLabels": false
}/*EDITMODE-END*/;

const DENSITY = { compact: { ui: '13px', gap: '6px' }, regular: { ui: '14px', gap: '8px' }, comfy: { ui: '15px', gap: '10px' } };
const FONTS = {
  "Inter": "'Inter', system-ui, sans-serif",
  "IBM Plex Sans": "'IBM Plex Sans', system-ui, sans-serif",
  "System": "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

function useRoute() {
  const [hash, setHash] = React.useState(window.location.hash || '#/');
  React.useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const m = hash.match(/^#\/doc\/(.+)$/);
  return { name: m ? 'editor' : 'library', docId: m ? decodeURIComponent(m[1]) : null };
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [docs, setDocs] = React.useState(() => DOCUMENTS.map(d => JSON.parse(JSON.stringify(d))));
  const [libLoading, setLibLoading] = React.useState(true);
  const route = useRoute();

  // initial library skeleton
  React.useEffect(() => { const id = setTimeout(() => setLibLoading(false), 600); return () => clearTimeout(id); }, []);

  // apply theme + tweaks to :root
  React.useEffect(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    r.style.setProperty('--accent', t.accent);
    r.style.setProperty('--app-font', FONTS[t.font] || FONTS.Inter);
    const d = DENSITY[t.density] || DENSITY.regular;
    r.style.setProperty('--ui-font', d.ui);
    r.style.setProperty('--gap', d.gap);
  }, [t.dark, t.accent, t.font, t.density]);

  function navigate(id) { window.location.hash = id ? `#/doc/${encodeURIComponent(id)}` : '#/'; }
  function onDocUpdated(nd) { setDocs(list => list.map(d => d.id === nd.id ? nd : d)); }

  return (
    <AppCtx.Provider value={{ dark: t.dark, setDark: (v) => setTweak('dark', v) }}>
      {route.name === 'editor'
        ? <Editor key={route.docId} docId={route.docId} navigate={navigate} onDocUpdated={onDocUpdated} setDocs={setDocs} toolLabels={t.toolLabels} />
        : <Library docs={docs} setDocs={setDocs} navigate={navigate} loading={libLoading} libView={t.libView} />}

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakColor label="Accent" value={t.accent}
          options={['#4f46e5', '#2563eb', '#0d9488', '#059669', '#e11d48', '#475569']}
          onChange={(v) => setTweak('accent', v)} />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        <TweakSection label="Typography" />
        <TweakSelect label="UI font" value={t.font} options={['Inter', 'IBM Plex Sans', 'System']}
          onChange={(v) => setTweak('font', v)} />
        <TweakRadio label="Density" value={t.density} options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Library view" value={t.libView} options={['grid', 'list']}
          onChange={(v) => setTweak('libView', v)} />
        <TweakToggle label="Toolbar labels" value={t.toolLabels} onChange={(v) => setTweak('toolLabels', v)} />
      </TweaksPanel>
    </AppCtx.Provider>
  );
}

Object.assign(window, { ThemeToggle, App });

ReactDOM.createRoot(document.getElementById('root')).render(
  <ToastProvider><App /></ToastProvider>
);
