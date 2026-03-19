interface BottomNavProps {
  activeTab: 'live' | 'reports';
  onTabChange: (tab: 'live' | 'reports') => void;
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const tab = (id: 'live' | 'reports', label: string) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => onTabChange(id)}
        className="flex-1 h-12 md:h-14 font-heading text-base md:text-lg tracking-widest font-bold bg-transparent"
        style={{
          color: active ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
          borderBottom: active ? '2px solid hsl(var(--primary))' : '2px solid transparent',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-shrink-0 border-t border-border">
      {tab('live', 'LIVE')}
      {tab('reports', 'REPORTS')}
    </div>
  );
}
