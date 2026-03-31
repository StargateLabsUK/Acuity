import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

type AdminTab = 'trusts' | 'users' | 'audit' | 'devices';

interface Trust {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  locked: boolean;
  trust_id: string | null;
  roles: string[];
}

interface AuditEntry {
  id: string;
  user_email: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface ShiftRow {
  id: string;
  callsign: string | null;
  operator_id: string | null;
  station: string | null;
  started_at: string | null;
  ended_at: string | null;
  trust_id: string | null;
  trust_name?: string;
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid hsl(147, 100%, 62%)' : '2px solid transparent',
  color: active ? '#FFFFFF' : '#4A6058',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.12em',
  cursor: 'pointer',
});

const cellStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #0F1820',
  fontSize: 14,
  color: '#C8D0CC',
};

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  color: '#4A6058',
  fontSize: 12,
  letterSpacing: '0.15em',
  fontWeight: 600,
};

const btnSmall: React.CSSProperties = {
  padding: '4px 12px',
  background: 'transparent',
  border: '1px solid #1E3028',
  color: '#C8D0CC',
  fontSize: 12,
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: "'IBM Plex Mono', monospace",
};

export default function Admin() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<AdminTab>('trusts');
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Trusts state
  const [trusts, setTrusts] = useState<Trust[]>([]);
  const [newTrustName, setNewTrustName] = useState('');
  const [newTrustSlug, setNewTrustSlug] = useState('');
  const [generatedPin, setGeneratedPin] = useState('');
  const [resetPinTrustId, setResetPinTrustId] = useState<string | null>(null);
  const [resetPinValue, setResetPinValue] = useState('');

  // Users state
  const [users, setUsers] = useState<UserRow[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserTrust, setNewUserTrust] = useState('');
  const [newUserRole, setNewUserRole] = useState<'command' | 'admin'>('command');
  const [inviteStatus, setInviteStatus] = useState('');

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  // Devices state
  const [shifts, setShifts] = useState<ShiftRow[]>([]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/login');
        return;
      }
      setUserId(session.user.id);
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id);
      
      if (!roles?.some(r => r.role === 'admin')) {
        navigate('/login');
        return;
      }
      setIsAdmin(true);
      setLoading(false);
    };
    checkAuth();
  }, [navigate]);

  const loadTrusts = useCallback(async () => {
    const { data } = await supabase.from('trusts').select('*').order('created_at', { ascending: false });
    if (data) setTrusts(data as Trust[]);
  }, []);

  const loadUsers = useCallback(async () => {
    const { data: profiles } = await supabase.from('profiles').select('*');
    const { data: roles } = await supabase.from('user_roles').select('*');
    if (profiles) {
      const userList: UserRow[] = profiles.map((p: any) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        locked: p.locked,
        trust_id: p.trust_id,
        roles: (roles || []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role),
      }));
      setUsers(userList);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
    const { data } = await query;
    if (data) setAuditLogs(data as AuditEntry[]);
  }, []);

  const loadShifts = useCallback(async () => {
    const { data } = await supabase
      .from('shifts')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(200);
    if (data) {
      const { data: trustsData } = await supabase.from('trusts').select('id, name');
      const trustMap = new Map((trustsData || []).map((t: any) => [t.id, t.name]));
      setShifts(data.map((s: any) => ({
        ...s,
        trust_name: s.trust_id ? trustMap.get(s.trust_id) || 'Unknown' : '—',
      })));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === 'trusts') loadTrusts();
    else if (tab === 'users') { loadUsers(); loadTrusts(); }
    else if (tab === 'audit') loadAudit();
    else if (tab === 'devices') loadShifts();
  }, [isAdmin, tab, loadTrusts, loadUsers, loadAudit, loadShifts]);

  const handleCreateTrust = async () => {
    if (!newTrustName || !newTrustSlug) return;
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    // Hash via edge function
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-trust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ action: 'create', name: newTrustName, slug: newTrustSlug, pin }),
    });
    if (res.ok) {
      setGeneratedPin(pin);
      setNewTrustName('');
      setNewTrustSlug('');
      loadTrusts();
    }
  };

  const handleResetPin = async (trustId: string) => {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-trust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ action: 'reset_pin', trust_id: trustId, pin }),
    });
    if (res.ok) {
      setResetPinTrustId(trustId);
      setResetPinValue(pin);
    }
  };

  const handleToggleTrust = async (trustId: string, active: boolean) => {
    await supabase.from('trusts').update({ active: !active }).eq('id', trustId);
    loadTrusts();
  };

  const handleInviteUser = async () => {
    if (!newUserEmail || !newUserPassword || !newUserTrust) {
      setInviteStatus('Email, password, and trust are required');
      return;
    }
    setInviteStatus('Creating account...');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-trust`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          action: 'invite_user',
          email: newUserEmail,
          password: newUserPassword,
          full_name: newUserName,
          trust_id: newUserTrust,
          role: newUserRole,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        setInviteStatus(`Account created for ${newUserEmail}`);
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserName('');
        setNewUserTrust('');
        setNewUserRole('command');
        loadUsers();
      } else {
        setInviteStatus(result.error || 'Failed to create account');
      }
    } catch {
      setInviteStatus('Network error');
    }
  };

  const handleToggleLock = async (profileId: string, locked: boolean) => {
    await supabase.from('profiles').update({ locked: !locked }).eq('id', profileId);
    loadUsers();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#080B10' }}>
        <p style={{ color: '#4A6058', letterSpacing: '0.15em' }}>LOADING...</p>
      </div>
    );
  }

  const filteredAudit = auditFilter
    ? auditLogs.filter(
        (a) =>
          (a.user_email || '').toLowerCase().includes(auditFilter.toLowerCase()) ||
          a.action.toLowerCase().includes(auditFilter.toLowerCase())
      )
    : auditLogs;

  return (
    <div className="min-h-screen" style={{ background: '#080B10' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#0F1820' }}>
        <div className="flex items-center gap-4">
          <span style={{ color: '#FFFFFF', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: '0.08em' }}>
            HERALD
          </span>
          <span style={{ color: '#4A6058', fontSize: 12, letterSpacing: '0.15em' }}>ADMIN</span>
        </div>
        <button onClick={handleLogout} style={{ ...btnSmall, fontSize: 11 }}>SIGN OUT</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: '#0F1820' }}>
        {(['trusts', 'users', 'audit', 'devices'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="p-4" style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* TRUSTS TAB */}
        {tab === 'trusts' && (
          <div>
            <div className="mb-6 p-4 rounded" style={{ background: '#0D1117', border: '1px solid #0F1820' }}>
              <p style={{ color: '#4A6058', fontSize: 12, letterSpacing: '0.15em', marginBottom: 12 }}>ADD NEW TRUST</p>
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label style={{ color: '#4A6058', fontSize: 11, display: 'block', marginBottom: 4 }}>NAME</label>
                  <input
                    value={newTrustName}
                    onChange={(e) => setNewTrustName(e.target.value)}
                    placeholder="Trust Name"
                    style={{ ...inputSmall }}
                  />
                </div>
                <div>
                  <label style={{ color: '#4A6058', fontSize: 11, display: 'block', marginBottom: 4 }}>SLUG</label>
                  <input
                    value={newTrustSlug}
                    onChange={(e) => setNewTrustSlug(e.target.value)}
                    placeholder="trust-slug"
                    style={{ ...inputSmall }}
                  />
                </div>
                <button onClick={handleCreateTrust} style={btnSmall}>CREATE & GENERATE PIN</button>
              </div>
              {generatedPin && (
                <p style={{ color: 'hsl(147, 100%, 62%)', fontSize: 16, marginTop: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
                  Generated PIN: <strong>{generatedPin}</strong> — share securely with station managers
                </p>
              )}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>NAME</th>
                  <th style={headerCellStyle}>SLUG</th>
                  <th style={headerCellStyle}>STATUS</th>
                  <th style={headerCellStyle}>CREATED</th>
                  <th style={headerCellStyle}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {trusts.map((t) => (
                  <tr key={t.id}>
                    <td style={cellStyle}>
                      {t.name}
                      {t.slug === 'arion-test' && (
                        <span style={{ color: '#FF9500', fontSize: 11, marginLeft: 8 }}>TEST ENVIRONMENT</span>
                      )}
                    </td>
                    <td style={cellStyle}>{t.slug}</td>
                    <td style={cellStyle}>
                      <span style={{ color: t.active ? 'hsl(147, 100%, 62%)' : '#FF3B30' }}>
                        {t.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td style={cellStyle}>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td style={cellStyle}>
                      <div className="flex gap-2 items-center flex-wrap">
                        <button onClick={() => handleResetPin(t.id)} style={btnSmall}>
                          RESET PIN
                        </button>
                        <button
                          onClick={() => handleToggleTrust(t.id, t.active)}
                          style={btnSmall}
                        >
                          {t.active ? 'DEACTIVATE' : 'ACTIVATE'}
                        </button>
                      </div>
                      {resetPinTrustId === t.id && resetPinValue && (
                        <p style={{ color: 'hsl(147, 100%, 62%)', fontSize: 14, marginTop: 6, fontFamily: "'IBM Plex Mono', monospace" }}>
                          New PIN: <strong>{resetPinValue}</strong>
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* USERS TAB */}
        {tab === 'users' && (
          <div>
            <div className="mb-6 p-4 rounded" style={{ background: '#0D1117', border: '1px solid #0F1820' }}>
              <p style={{ color: '#4A6058', fontSize: 12, letterSpacing: '0.15em', marginBottom: 12 }}>ADD NEW USER</p>
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label style={{ color: '#4A6058', fontSize: 11, display: 'block', marginBottom: 4 }}>EMAIL</label>
                  <input
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="user@trust.nhs.uk"
                    type="email"
                    style={{ ...inputSmall, width: 220 }}
                  />
                </div>
                <div>
                  <label style={{ color: '#4A6058', fontSize: 11, display: 'block', marginBottom: 4 }}>PASSWORD</label>
                  <input
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Temporary password"
                    type="text"
                    style={{ ...inputSmall, width: 180 }}
                  />
                </div>
                <div>
                  <label style={{ color: '#4A6058', fontSize: 11, display: 'block', marginBottom: 4 }}>FULL NAME</label>
                  <input
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Optional"
                    style={{ ...inputSmall, width: 160 }}
                  />
                </div>
                <div>
                  <label style={{ color: '#4A6058', fontSize: 11, display: 'block', marginBottom: 4 }}>TRUST</label>
                  <select
                    value={newUserTrust}
                    onChange={(e) => setNewUserTrust(e.target.value)}
                    style={{ ...inputSmall, width: 200 }}
                  >
                    <option value="">Select trust...</option>
                    {trusts.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ color: '#4A6058', fontSize: 11, display: 'block', marginBottom: 4 }}>ROLE</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as 'command' | 'admin')}
                    style={{ ...inputSmall, width: 130 }}
                  >
                    <option value="command">Command</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button onClick={handleInviteUser} style={btnSmall}>CREATE ACCOUNT</button>
              </div>
              {inviteStatus && (
                <p style={{
                  color: inviteStatus.startsWith('Account created') ? 'hsl(147, 100%, 62%)' : '#FF9500',
                  fontSize: 13,
                  marginTop: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}>
                  {inviteStatus}
                </p>
              )}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>EMAIL</th>
                  <th style={headerCellStyle}>NAME</th>
                  <th style={headerCellStyle}>TRUST</th>
                  <th style={headerCellStyle}>ROLES</th>
                  <th style={headerCellStyle}>STATUS</th>
                  <th style={headerCellStyle}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={cellStyle}>{u.email || '—'}</td>
                    <td style={cellStyle}>{u.full_name || '—'}</td>
                    <td style={cellStyle}>
                      {u.trust_id ? trusts.find(t => t.id === u.trust_id)?.name || u.trust_id.slice(0, 8) : '—'}
                    </td>
                    <td style={cellStyle}>{u.roles.join(', ') || 'none'}</td>
                    <td style={cellStyle}>
                      <span style={{ color: u.locked ? '#FF3B30' : 'hsl(147, 100%, 62%)' }}>
                        {u.locked ? 'LOCKED' : 'ACTIVE'}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <button onClick={() => handleToggleLock(u.id, u.locked)} style={btnSmall}>
                        {u.locked ? 'UNLOCK' : 'LOCK'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* AUDIT TAB */}
        {tab === 'audit' && (
          <div>
            <input
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              placeholder="Filter by user or action..."
              style={{ ...inputSmall, width: '100%', marginBottom: 16 }}
            />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>TIMESTAMP</th>
                  <th style={headerCellStyle}>USER</th>
                  <th style={headerCellStyle}>ACTION</th>
                  <th style={{ ...headerCellStyle, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((a) => {
                  const isExpanded = expandedAuditId === a.id;
                  return (
                    <React.Fragment key={a.id}>
                      <tr
                        onClick={() => setExpandedAuditId(isExpanded ? null : a.id)}
                        style={{ cursor: 'pointer', background: isExpanded ? 'rgba(61, 255, 140, 0.04)' : 'transparent' }}
                      >
                        <td style={cellStyle}>{new Date(a.created_at).toLocaleString()}</td>
                        <td style={cellStyle}>{a.user_email || '—'}</td>
                        <td style={cellStyle}>{a.action}</td>
                        <td style={{ ...cellStyle, textAlign: 'center', fontSize: 12, color: '#4A6058' }}>
                          {isExpanded ? '▲' : '▼'}
                        </td>
                      </tr>
                      {isExpanded && a.details && (
                        <tr>
                          <td colSpan={4} style={{ padding: 0, borderBottom: '1px solid #0F1820' }}>
                            <div style={{
                              padding: '16px 20px',
                              background: 'rgba(13, 17, 23, 0.6)',
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                              gap: 12,
                            }}>
                              {Object.entries(a.details).map(([key, val]) => (
                                <div key={key} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                  <div style={{ fontSize: 11, color: '#4A6058', letterSpacing: '0.1em', marginBottom: 2, textTransform: 'uppercase' }}>
                                    {key.replace(/_/g, ' ')}
                                  </div>
                                  <div style={{
                                    fontSize: 13,
                                    color: '#C8D0CC',
                                    wordBreak: 'break-all',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    borderRadius: 3,
                                    padding: '6px 8px',
                                  }}>
                                    {typeof val === 'object' && val !== null
                                      ? Array.isArray(val)
                                        ? val.join(', ')
                                        : JSON.stringify(val, null, 2)
                                      : String(val ?? '—')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                      {isExpanded && !a.details && (
                        <tr>
                          <td colSpan={4} style={{ ...cellStyle, color: '#4A6058', fontStyle: 'italic' }}>
                            No details available
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredAudit.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...cellStyle, textAlign: 'center', color: '#4A6058' }}>
                      No audit entries found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* DEVICES TAB */}
        {tab === 'devices' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headerCellStyle}>TRUST</th>
                <th style={headerCellStyle}>CALLSIGN</th>
                <th style={headerCellStyle}>OPERATOR ID</th>
                <th style={headerCellStyle}>STATION</th>
                <th style={headerCellStyle}>STARTED</th>
                <th style={headerCellStyle}>ENDED</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td style={cellStyle}>{s.trust_name || '—'}</td>
                  <td style={cellStyle}>{s.callsign || '—'}</td>
                  <td style={cellStyle}>{s.operator_id || '—'}</td>
                  <td style={cellStyle}>{s.station || '—'}</td>
                  <td style={cellStyle}>{s.started_at ? new Date(s.started_at).toLocaleString() : '—'}</td>
                  <td style={cellStyle}>{s.ended_at ? new Date(s.ended_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inputSmall: React.CSSProperties = {
  background: '#0D1117',
  border: '1px solid #0F1820',
  color: '#C8D0CC',
  padding: '8px 12px',
  borderRadius: 3,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 14,
  outline: 'none',
};
