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
      setUtc(
        n.getUTCHours().toString().padStart(2, '0') + ':' +
        n.getUTCMinutes().toString().padStart(2, '0') + ':' +
        n.getUTCSeconds().toString().padStart(2, '0') + 'Z'
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const pill = (label: string, count: number, color: string) => (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1"
      style={{
        background: `${color}10`,
        border: `1px solid ${color}`,
        borderRadius: 2,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'IBM Plex Mono, monospace' }}>
        {label} · {count}
      </span>
    </div>
  );

  return (
    <div
      className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{ borderBottom: '1px solid #0F1820', background: '#0D1117' }}
    >
      {/* Left */}
      <div className="flex flex-col">
        <span className="font-heading" style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '0.08em' }}>
          HERALD COMMAND
        </span>
        <span style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.05em' }}>
          REAL-TIME FIELD INTELLIGENCE
        </span>
      </div>

      {/* Centre pills */}
      <div className="hidden md:flex items-center gap-2">
        {pill('P1', priorityCounts.P1, '#FF3B30')}
        {pill('P2', priorityCounts.P2, '#FF9500')}
        {pill('P3', priorityCounts.P3, '#34C759')}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: connected ? '#3DFF8C' : '#FF3B30',
              animation: connected ? 'breathe 2s ease-in-out infinite' : 'none',
            }}
          />
          <span style={{ fontSize: 9, color: connected ? '#3DFF8C' : '#FF3B30', letterSpacing: '0.05em' }}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
        <span className="font-mono" style={{ fontSize: 11, color: '#3A5048' }}>{utc}</span>
      </div>
    </div>
  );
}
