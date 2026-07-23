import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { fetchWeather, type WeatherData } from '../lib/api';

export default function Layout() {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    fetchWeather().then(setWeather).catch(() => setWeather(null));
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 backdrop-blur">
        <h1 className="text-lg font-bold tracking-tight">RTD Transit Nexus</h1>
        {weather && (
          <span className="flex items-center gap-1.5 text-sm text-slate-300">
            <span>{weather.icon}</span>
            <span>{weather.temp}°F</span>
          </span>
        )}
      </header>

      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
