import { useEffect, useState } from 'react';

interface TopBarProps {
  micStatus: 'pending' | 'granted' | 'denied';
  aiStatus: 'ok' | 'error';
  syncStatus: 'ok' | 'error' | 'offline';
}

export function TopBar({ micStatus, aiStatus, syncStatus }: TopBarProps) {
  const [utc, setUtc] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setUtc(
        now.getUTCHours().toString().padStart(2, '0') + ':' +
        now.getUTCMinutes().toString().padStart(2, '0') + ':' +
        now.getUTCSeconds().toString().padStart(2, '0') + 'Z'
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const dot = (label: string, ok: boolean, warn?: boolean) => (
    <div className="flex items-center gap-1.5">
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: ok ? '#3DFF8C' : warn ? '#FF9500' : '#FF3B30' }}
      />
      <span style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.05em' }}>{label}</span>
    </div>
  );

  return (
    <div
      className="flex items-center justify-between px-4 h-12 flex-shrink-0"
      style={{ borderBottom: '1px solid #0F1820' }}
    >
      <span
        className="font-heading"
        style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '0.08em' }}
      >
        HERALD
      </span>
      <div className="flex items-center gap-4">
        {dot('MIC', micStatus === 'granted')}
        {dot('AI', aiStatus === 'ok')}
        {dot('SYNC', syncStatus === 'ok', syncStatus === 'offline')}
        <span className="font-mono" style={{ fontSize: 11, color: '#3A5048' }}>
          {utc}
        </span>
      </div>
    </div>
  );
}
