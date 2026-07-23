import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

/**
 * Draggable bottom sheet that snaps to a set of heights (fractions of its
 * positioned ancestor's height). Drag the handle to resize; releases snap to
 * the nearest point.
 */
export default function BottomSheet({
  snapPoints = [0.16, 0.5, 0.92],
  initialSnap = 1,
  expandTrigger,
  header,
  children,
}: {
  snapPoints?: number[];
  initialSnap?: number;
  expandTrigger?: number;
  header?: ReactNode;
  children: ReactNode;
}) {
  const [snap, setSnap] = useState(initialSnap);

  useEffect(() => {
    if (expandTrigger != null) setSnap(snapPoints.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandTrigger]);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const containerHeight = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    containerHeight.current = sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight;
    dragStartY.current = e.clientY;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragOffset(dragStartY.current - e.clientY);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);

    // A near-zero drag is a tap — cycle to the next snap point so the sheet
    // becomes the focal point with a single tap, not just a drag. Skip this
    // if the tap landed on an interactive element in the header.
    if (Math.abs(dragOffset) < 5 && !(e.target as HTMLElement).closest('button, input, a')) {
      setDragOffset(0);
      setSnap((s) => (s + 1) % snapPoints.length);
      return;
    }

    const baseHeight = snapPoints[snap] * containerHeight.current;
    const fraction = (baseHeight + dragOffset) / containerHeight.current;
    let nearest = 0;
    let best = Infinity;
    snapPoints.forEach((sp, i) => {
      const d = Math.abs(sp - fraction);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setSnap(nearest);
    setDragOffset(0);
  }

  const heightPct = snapPoints[snap] * 100;
  const style = dragging
    ? { height: `calc(${heightPct}% + ${dragOffset}px)`, transition: 'none' }
    : { height: `${heightPct}%`, transition: 'height 0.2s ease-out' };

  return (
    <div
      ref={sheetRef}
      className="absolute inset-x-0 bottom-0 z-[1000] flex flex-col rounded-t-2xl border-t border-slate-800 bg-slate-900/95 shadow-2xl backdrop-blur"
      style={style}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(false)}
        className="flex shrink-0 cursor-grab touch-none flex-col items-center gap-1 pb-1 pt-2 active:cursor-grabbing"
      >
        <div className="h-1.5 w-10 rounded-full bg-slate-600" />
        {header}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
    </div>
  );
}
