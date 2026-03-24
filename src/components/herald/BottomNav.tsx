interface BottomNavProps {
  activeTab: 'live' | 'reports' | 'incidents';
  onTabChange: (tab: 'live' | 'reports' | 'incidents') => void;
  hideTabs?: ('live' | 'reports' | 'incidents')[];
}

export function BottomNav({ activeTab, onTabChange, hideTabs = [] }: BottomNavProps) {
  const tabs: { id: 'live' | 'reports' | 'incidents'; label: string }[] = [
    { id: 'live', label: 'LIVE' },
    { id: 'incidents', label: 'INCIDENTS' },
    { id: 'reports', label: 'REPORTS' },
  ];

  const visible = tabs.filter(t => !hideTabs.includes(t.id));

  return (
    <div className="flex flex-shrink-0 border-t border-border">
      {visible.map(({ id, label }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className="flex-1 h-14 md:h-14 font-heading text-lg md:text-lg tracking-widest font-bold bg-transparent"
            style={{
              color: active ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
              borderBottom: active ? '2px solid hsl(var(--primary))' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
