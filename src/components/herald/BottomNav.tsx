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
        className="flex-1 h-14 font-heading text-sm tracking-widest"
        style={{
          color: active ? '#3DFF8C' : '#1E3028',
          borderBottom: active ? '2px solid #3DFF8C' : '2px solid transparent',
          fontWeight: 700,
          background: 'transparent',
          fontSize: 13,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      className="flex flex-shrink-0"
      style={{ borderTop: '1px solid #0F1820' }}
    >
      {tab('live', 'LIVE')}
      {tab('reports', 'REPORTS')}
    </div>
  );
}
