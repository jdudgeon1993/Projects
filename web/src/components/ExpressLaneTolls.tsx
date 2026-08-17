import { useEffect, useMemo, useState } from 'react';
import {
  DIRECTION_LABELS,
  TOLL_SCHEDULE_EFFECTIVE,
  getCurrentBand,
  getScheduleFor,
  type TollBand,
  type TollDirection,
} from '../lib/tolls';

function formatPrice(price: number | null): string {
  return price == null ? '—' : `$${price.toFixed(2)}`;
}

/** Find the next band (today, chronological) with a lower ExpressToll price than the current one. */
function findNextCheaperBand(schedule: TollBand[], currentIndex: number): TollBand | null {
  const current = schedule[currentIndex];
  if (current.expressToll == null) return null;
  for (let i = currentIndex + 1; i < schedule.length; i++) {
    const band = schedule[i];
    if (band.expressToll != null && band.expressToll < current.expressToll) return band;
  }
  return null;
}

export default function ExpressLaneTolls() {
  const [direction, setDirection] = useState<TollDirection>('northbound');
  const [showBothRates, setShowBothRates] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const schedule = useMemo(() => getScheduleFor(direction, now), [direction, now]);
  const currentBand = useMemo(() => getCurrentBand(direction, now), [direction, now]);
  const currentIndex = schedule.indexOf(currentBand);
  const nextCheaper = useMemo(() => findNextCheaperBand(schedule, currentIndex), [schedule, currentIndex]);
  const isClosed = currentBand.expressToll == null;
  const meta = DIRECTION_LABELS[direction];

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div>
        <h3 className="text-lg font-semibold">I-25 Central Express Lane Tolls</h3>
        <p className="text-xs text-slate-500">
          20th Street ↔ US-36 · flat toll per trip, based on the price posted when you enter — not per mile.
          Rates effective {TOLL_SCHEDULE_EFFECTIVE}.
        </p>
      </div>

      {/* Direction toggle */}
      <div className="flex overflow-hidden rounded border border-slate-700 text-xs">
        {(['northbound', 'southbound'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`flex-1 px-3 py-2 text-left ${
              direction === d ? 'bg-sky-600 font-medium text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            <div className="font-semibold">{DIRECTION_LABELS[d].short}</div>
            <div className="text-[10px] opacity-80">{DIRECTION_LABELS[d].description}</div>
          </button>
        ))}
      </div>

      {/* Current price */}
      <div
        className={`rounded-lg border p-3 ${
          isClosed ? 'border-slate-700 bg-slate-950' : 'border-sky-700 bg-sky-950/40'
        }`}
      >
        {isClosed ? (
          <>
            <p className="text-sm font-medium text-slate-300">
              {meta.short} lane is closed right now ({currentBand.label})
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {direction === 'northbound'
                ? 'Northbound reopens at 12:00 PM on weekdays.'
                : 'Southbound only runs 5:00 AM – 11:00 AM on weekdays, and is closed entirely on weekends.'}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-slate-400">Right now ({currentBand.label})</p>
              <p className="text-2xl font-bold text-sky-300">{formatPrice(currentBand.expressToll)}</p>
            </div>
            <p className="text-xs text-slate-500">with ExpressToll transponder</p>
            {showBothRates && (
              <p className="mt-1 text-xs text-slate-400">
                No transponder (LicensePlateToll): <span className="text-slate-300">{formatPrice(currentBand.licensePlateToll)}</span>
              </p>
            )}
            {nextCheaper && (
              <p className="mt-2 flex items-start gap-1 text-xs text-emerald-400">
                <span>↓</span>
                <span>
                  Drops to {formatPrice(nextCheaper.expressToll)} at {nextCheaper.label.split(' – ')[0]}
                </span>
              </p>
            )}
          </>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={showBothRates}
          onChange={(e) => setShowBothRates(e.target.checked)}
          className="rounded border-slate-700 bg-slate-800"
        />
        Show LicensePlateToll (no-transponder) rates
      </label>

      {/* Full day schedule */}
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          {meta.short} · full day schedule
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-slate-400">
                <th className="px-2 py-1.5 text-left font-medium">Time of Day</th>
                <th className="px-2 py-1.5 text-right font-medium">ExpressToll</th>
                {showBothRates && <th className="px-2 py-1.5 text-right font-medium">No Transponder</th>}
              </tr>
            </thead>
            <tbody>
              {schedule.map((band, i) => {
                const isCurrent = i === currentIndex;
                const closed = band.expressToll == null;
                return (
                  <tr
                    key={i}
                    className={`border-t border-slate-800 ${
                      isCurrent ? 'bg-sky-950/50' : i % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900'
                    }`}
                  >
                    <td className={`px-2 py-1.5 ${isCurrent ? 'font-semibold text-sky-300' : 'text-slate-300'}`}>
                      {band.label}
                      {isCurrent && <span className="ml-1.5 text-[10px] text-sky-400">● now</span>}
                    </td>
                    <td className={`px-2 py-1.5 text-right ${closed ? 'text-slate-600' : isCurrent ? 'font-semibold text-sky-300' : 'text-slate-300'}`}>
                      {closed ? 'Closed' : formatPrice(band.expressToll)}
                    </td>
                    {showBothRates && (
                      <td className={`px-2 py-1.5 text-right ${closed ? 'text-slate-600' : 'text-slate-400'}`}>
                        {closed ? 'Closed' : formatPrice(band.licensePlateToll)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-slate-600">
        4+ axle vehicles: $25.00 surcharge. Motorcycles: free, all hours. HOV 3+: free with a switchable HOV
        transponder. Source: CDOT published rate schedule — update annually when CDOT republishes (typically each
        July 1st).
      </p>
    </div>
  );
}
