import { useEffect, useState } from 'react';

interface Props {
  priorityCounts: { P1: number; P2: number; P3: number };
  connected: boolean;
}

export function CommandTopBar({ priorityCounts, connected }: Props) {
  const [utc, setUtc] = useState('');

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      const date = n.getUTCDate().toString().padStart(2, '0') + '/' +
        (n.getUTCMonth() + 1).toString().padStart(2, '0') + '/' +
        n.getUTCFullYear();
      const time = n.getUTCHours().toString().padStart(2, '0') + ':' +
        n.getUTCMinutes().toString().padStart(2, '0') + ':' +
        n.getUTCSeconds().toString().padStart(2, '0') + 'Z';
      setUtc(date + ' ' + time);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const pill = (label: string, count: number, color: string) => (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-sm"
      style={{
        background: `${color}10`,
        border: `1px solid ${color}`,
      }}
    >
      <span className="text-lg md:text-lg font-bold" style={{ color }}>
        {label} · {count}
      </span>
    </div>
  );

  return (
    <div className="flex items-center justify-between px-3 md:px-5 py-2 md:py-3 flex-shrink-0 border-b border-border" style={{ background: 'var(--herald-command-bg)' }}>
      <div className="flex items-center gap-2 md:gap-3">
        <div className="flex flex-col">
          <span className="font-heading text-lg md:text-2xl text-foreground tracking-[0.08em]">
            HERALD
          </span>
          <span className="text-sm md:text-sm tracking-wide hidden sm:block" style={{ color: '#4A6058' }}>
            Real-time Field Intelligence
          </span>
        </div>
      </div>

      <div className="hidden lg:flex items-center gap-2">
        {pill('P1', priorityCounts.P1, '#FF3B30')}
        {pill('P2', priorityCounts.P2, '#FF9500')}
        {pill('P3', priorityCounts.P3, '#34C759')}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <span className="text-lg md:text-lg text-foreground">{utc}</span>
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: connected ? 'hsl(var(--primary))' : '#FF3B30',
              animation: connected ? 'breathe 2s ease-in-out infinite' : 'none',
            }}
          />
          <span className="text-lg md:text-lg tracking-wide" style={{ color: connected ? 'hsl(var(--primary))' : '#FF3B30' }}>
            {connected ? 'LIVE' : 'OFF'}
          </span>
        </div>
      </div>
    </div>
  );
}
