import { useEffect, useState } from 'react';

interface TopBarProps {
  micStatus: 'pending' | 'granted' | 'denied';
  aiStatus: 'ok' | 'error';
  syncStatus: 'ok' | 'error' | 'offline' | 'auth_error';
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
    <div className="flex items-center gap-1">
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: ok ? 'hsl(var(--primary))' : warn ? '#FF9500' : '#FF3B30' }}
      />
      <span className="text-lg md:text-lg text-foreground tracking-wide">{label}</span>
    </div>
  );

  return (
    <div className="flex flex-col items-center px-3 md:px-4 py-2 md:py-0 md:flex-row md:justify-between md:h-14 flex-shrink-0 border-b border-border">
      <span className="font-heading text-2xl md:text-3xl text-foreground tracking-[0.08em]">
        HERALD
      </span>
      <div className="flex items-center gap-2 md:gap-4 mt-1 md:mt-0">
        {dot('MIC', micStatus === 'granted')}
        {dot('AI', aiStatus === 'ok')}
        {dot('SYNC', syncStatus === 'ok', syncStatus === 'offline')}
        <span className="text-lg md:text-lg text-foreground">{utc}</span>
      </div>
    </div>
  );
}