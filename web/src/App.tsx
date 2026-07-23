import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import MapPage from './pages/MapPage';
import InstallPrompt from './components/InstallPrompt';

function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[3000] flex items-center justify-center gap-2 bg-amber-500/90 px-3 py-1.5 text-xs font-semibold text-slate-950 backdrop-blur">
      <span>📡</span> You're offline — showing cached data
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <OfflineBanner />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MapPage />} />
        </Route>
      </Routes>
      <InstallPrompt />
    </BrowserRouter>
  );
}

export default App;
