import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';

type OwnerTab = 'trusts' | 'users' | 'audit' | 'devices';
type AdminTab = 'my-trust' | 'users' | 'audit' | 'devices';

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
  trust_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AuditShiftMeta {
  callsign: string | null;
  operator_id: string | null;
  started_at: string | null;
}

interface AuditReportMeta {
  incident_number: string | null;
  headline: string | null;
}

interface AuditViewModel {
  entry: AuditEntry;
  actor: string;
  actionSummary: string;
  incidentRef: string;
  shiftRef: string;
  timeRef: string;
  detailsSummary: string;
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
  background: active ? 'rgba(61, 255, 140, 0.08)' : 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid hsl(147, 100%, 62%)' : '2px solid transparent',
  color: active ? '#1A1A1A' : '#4A6058',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.12em',
  cursor: 'pointer',
});

const cellStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #E2E2DE',
  fontSize: 14,
  color: '#333333',
};

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  color: '#666666',
  fontSize: 12,
  letterSpacing: '0.15em',
  fontWeight: 600,
};

const btnSmall: React.CSSProperties = {
  padding: '4px 12px',
  background: 'transparent',
  border: '1px solid #1E3028',
  color: '#333333',
  fontSize: 12,
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: "'IBM Plex Mono', monospace",
};

const inputSmall: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E2DE',
  color: '#333333',
  padding: '8px 12px',
  borderRadius: 3,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 14,
  outline: 'none',
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  trust_created: 'Trust Created',
  trust_pin_reset: 'Trust PIN Reset',
  user_invited: 'User Invited',
  shift_started: 'Logged In (Shift Started)',
  shift_ended: 'Logged Out (Shift Ended)',
  shift_end_blocked_open_patients: 'Logout Blocked (Open Patients)',
  shift_link_redeemed: 'Logged In (Field App)',
  shift_link_left: 'Logged Out (Field App)',
  incident_created: 'Incident Created',
  incident_updated: 'Incident Updated',
  disposition_recorded: 'Disposition Recorded',
  transfer_initiated: 'Transfer Initiated',
  transfer_accepted: 'Transfer Accepted',
  transfer_declined: 'Transfer Declined',
  data_exported: 'Data Exported',
  data_deleted: 'Data Deleted',
};

const OPERATIONAL_ACTIONS = new Set([
  'shift_started',
  'shift_ended',
  'shift_end_blocked_open_patients',
  'shift_link_redeemed',
  'shift_link_left',
  'incident_created',
  'incident_updated',
  'disposition_recorded',
  'transfer_initiated',
  'transfer_accepted',
  'transfer_declined',
]);

function detailString(details: Record<string, unknown> | null, key: string): string {
  if (!details) return '';
  const value = details[key];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function detailArray(details: Record<string, unknown> | null, key: string): string[] {
  if (!details) return [];
  const value = details[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function extractReportId(details: Record<string, unknown> | null): string {
  return detailString(details, 'report_id') || detailString(details, 'incident_id');
}

function extractShiftIds(details: Record<string, unknown> | null): string[] {
  const ids = [
    detailString(details, 'shift_id'),
    detailString(details, 'from_shift_id'),
    detailString(details, 'to_shift_id'),
  ].filter(Boolean);
  return [...new Set(ids)];
}

function extractPrimaryShiftId(details: Record<string, unknown> | null): string {
  return (
    detailString(details, 'shift_id') ||
    detailString(details, 'from_shift_id') ||
    detailString(details, 'to_shift_id')
  );
}

function normalizeDisposition(disposition: string): string {
  if (!disposition) return '';
  return disposition.replace(/_/g, ' ');
}

function formatTimeRef(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function buildAuditViewModel(
  entry: AuditEntry,
  shiftMeta: Record<string, AuditShiftMeta>,
  reportMeta: Record<string, AuditReportMeta>,
): AuditViewModel {
  const details = entry.details;
  const primaryShiftId = extractPrimaryShiftId(details);
  const reportId = extractReportId(details);
  const report = reportId ? reportMeta[reportId] : null;
  const incidentNumber = detailString(details, 'incident_number') || report?.incident_number || '';

  const callsign =
    detailString(details, 'callsign') ||
    detailString(details, 'from_callsign') ||
    detailString(details, 'to_callsign') ||
    detailString(details, 'accepting_callsign') ||
    detailString(details, 'declining_callsign') ||
    (primaryShiftId ? shiftMeta[primaryShiftId]?.callsign ?? '' : '');

  const crewId =
    detailString(details, 'operator_id') ||
    detailString(details, 'declined_by') ||
    detailString(details, 'from_operator_id') ||
    (primaryShiftId ? shiftMeta[primaryShiftId]?.operator_id ?? '' : '');

  const actor = crewId || callsign || entry.user_email || 'System';

  let actionSummary = formatAuditAction(entry.action);
  let detailsSummary = '';

  if (entry.action === 'shift_started') {
    actionSummary = `${callsign || 'Crew'} logged in and started shift`;
  } else if (entry.action === 'shift_ended') {
    actionSummary = `${callsign || 'Crew'} logged out and ended shift`;
  } else if (entry.action === 'shift_end_blocked_open_patients') {
    const openCount = detailArray(details, 'open_incident_ids').length;
    const transferCount = detailString(details, 'outstanding_accepted_transfer_count');
    actionSummary = 'Logout blocked: patients still active';
    detailsSummary = `${openCount} open incident(s), ${transferCount || '0'} accepted transfer(s) pending`;
  } else if (entry.action === 'shift_link_redeemed') {
    actionSummary = `${crewId || 'Crew member'} logged in to field app`;
  } else if (entry.action === 'shift_link_left') {
    actionSummary = `${crewId || 'Crew member'} logged out from field app`;
  } else if (entry.action === 'disposition_recorded') {
    const casualty = detailString(details, 'casualty_label') || detailString(details, 'casualty_key');
    const disposition = normalizeDisposition(detailString(details, 'disposition'));
    actionSummary = `Disposition recorded: ${disposition || 'unknown outcome'}`;
    detailsSummary = casualty ? `Patient: ${casualty}` : '';
  } else if (entry.action === 'transfer_initiated') {
    const casualty = detailString(details, 'casualty_label') || detailString(details, 'casualty_key');
    actionSummary = `Transfer initiated${casualty ? ` for ${casualty}` : ''}`;
    detailsSummary = `${detailString(details, 'from_callsign') || 'Unknown'} -> ${detailString(details, 'to_callsign') || 'Unknown'}`;
  } else if (entry.action === 'transfer_accepted') {
    const casualty = detailString(details, 'casualty_label') || detailString(details, 'casualty_key');
    actionSummary = `Transfer accepted${casualty ? ` for ${casualty}` : ''}`;
    detailsSummary = `${detailString(details, 'from_callsign') || 'Unknown'} -> ${detailString(details, 'to_callsign') || 'Unknown'}`;
  } else if (entry.action === 'transfer_declined') {
    const casualty = detailString(details, 'casualty_label') || detailString(details, 'casualty_key');
    actionSummary = `Transfer declined${casualty ? ` for ${casualty}` : ''}`;
    detailsSummary = detailString(details, 'reason') || 'No decline reason provided';
  } else if (entry.action === 'incident_created') {
    actionSummary = 'Incident created';
    detailsSummary = report?.headline || '';
  } else if (entry.action === 'incident_updated') {
    actionSummary = 'Incident updated';
    detailsSummary = report?.headline || '';
  }

  const incidentRef = incidentNumber || (reportId ? `Report ${reportId}` : '—');
  const shiftRef = primaryShiftId || '—';
  const timeRef = formatTimeRef(
    detailString(details, 'started_at') ||
    detailString(details, 'ended_at') ||
    detailString(details, 'accepted_at') ||
    detailString(details, 'declined_at') ||
    detailString(details, 'initiated_at') ||
    detailString(details, 'closed_at') ||
    (primaryShiftId ? shiftMeta[primaryShiftId]?.started_at ?? null : null),
  );
  if (!detailsSummary && callsign) {
    detailsSummary = `Callsign: ${callsign}`;
  }
  if (!detailsSummary) {
    detailsSummary = '—';
  }

  return {
    entry,
    actor,
    actionSummary,
    incidentRef,
    shiftRef,
    timeRef,
    detailsSummary,
  };
}

function formatAuditAction(action: string): string {
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  return action.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function Admin() {
  const navigate = useNavigate();
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userTrustId, setUserTrustId] = useState<string | null>(null);

  // Tab state
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('trusts');
  const [adminTab, setAdminTab] = useState<AdminTab>('my-trust');

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
  const [newUserRole, setNewUserRole] = useState<'admin' | 'command'>('command');
  const [inviteStatus, setInviteStatus] = useState('');

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [auditShiftMeta, setAuditShiftMeta] = useState<Record<string, AuditShiftMeta>>({});
  const [auditReportMeta, setAuditReportMeta] = useState<Record<string, AuditReportMeta>>({});

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

      if (roles?.some(r => r.role === 'owner')) {
        setRole('owner');
      } else if (roles?.some(r => r.role === 'admin')) {
        setRole('admin');
      } else {
        navigate('/login');
        return;
      }

      // Get user's trust_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('trust_id')
        .eq('id', session.user.id)
        .maybeSingle();

      setUserTrustId(profile?.trust_id || null);
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
      let userList: UserRow[] = profiles.map((p: any) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        locked: p.locked,
        trust_id: p.trust_id,
        roles: (roles || []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role),
      }));
      // Hide owner accounts from the list
      userList = userList.filter(u => !u.roles.includes('owner'));
      // Trust admins only see users in their trust
      if (role === 'admin' && userTrustId) {
        userList = userList.filter(u => u.trust_id === userTrustId);
      }
      setUsers(userList);
    }
  }, [role, userTrustId]);

  const loadAudit = useCallback(async () => {
    const { data } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
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
    const hydrateAuditContext = async () => {
      if (auditLogs.length === 0) {
        setAuditShiftMeta({});
        setAuditReportMeta({});
        return;
      }

      const shiftIds = new Set<string>();
      const reportIds = new Set<string>();
      for (const entry of auditLogs) {
        for (const shiftId of extractShiftIds(entry.details)) {
          if (shiftId) shiftIds.add(shiftId);
        }
        const reportId = extractReportId(entry.details);
        if (reportId) reportIds.add(reportId);
      }

      if (shiftIds.size > 0) {
        const { data: shiftRows } = await supabase
          .from('shifts')
          .select('id, callsign, operator_id, started_at')
          .in('id', Array.from(shiftIds));
        const mapped: Record<string, AuditShiftMeta> = {};
        for (const row of shiftRows ?? []) {
          mapped[row.id] = {
            callsign: row.callsign ?? null,
            operator_id: row.operator_id ?? null,
            started_at: row.started_at ?? null,
          };
        }
        setAuditShiftMeta(mapped);
      } else {
        setAuditShiftMeta({});
      }

      if (reportIds.size > 0) {
        const { data: reportRows } = await supabase
          .from('herald_reports')
          .select('id, incident_number, headline')
          .in('id', Array.from(reportIds));
        const mapped: Record<string, AuditReportMeta> = {};
        for (const row of reportRows ?? []) {
          mapped[row.id] = {
            incident_number: row.incident_number ?? null,
            headline: row.headline ?? null,
          };
        }
        setAuditReportMeta(mapped);
      } else {
        setAuditReportMeta({});
      }
    };

    void hydrateAuditContext();
  }, [auditLogs]);

  // Load data based on active tab
  const activeTab = role === 'owner' ? ownerTab : adminTab;
  useEffect(() => {
    if (!role) return;
    if (activeTab === 'trusts' || activeTab === 'my-trust') loadTrusts();
    else if (activeTab === 'users') { loadUsers(); loadTrusts(); }
    else if (activeTab === 'audit') loadAudit();
    else if (activeTab === 'devices') loadShifts();
  }, [role, activeTab, loadTrusts, loadUsers, loadAudit, loadShifts]);

  const callAdminApi = async (body: Record<string, unknown>) => {
    const session = (await supabase.auth.getSession()).data.session;
    return fetch(`${SUPABASE_URL}/functions/v1/admin-trust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session?.access_token || SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
    });
  };

  const handleCreateTrust = async () => {
    if (!newTrustName || !newTrustSlug) return;
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const res = await callAdminApi({ action: 'create', name: newTrustName, slug: newTrustSlug, pin });
    if (res.ok) {
      setGeneratedPin(pin);
      setNewTrustName('');
      setNewTrustSlug('');
      loadTrusts();
    }
  };

  const handleResetPin = async (trustId: string) => {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    try {
      // Hash the PIN using SHA-256 (same as edge function)
      const encoder = new TextEncoder();
      const data = encoder.encode(pin + 'herald-salt-2026');
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = '$sha256$' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Update directly via Supabase client
      const { error } = await supabase
        .from('trusts')
        .update({ trust_pin_hash: hash })
        .eq('id', trustId);

      if (error) {
        setResetPinTrustId(trustId);
        setResetPinValue(`ERROR: ${error.message}`);
      } else {
        setResetPinTrustId(trustId);
        setResetPinValue(pin);
      }
    } catch (e: any) {
      setResetPinTrustId(trustId);
      setResetPinValue(`ERROR: ${e?.message || 'Failed'}`);
    }
  };

  const handleToggleTrust = async (trustId: string, active: boolean) => {
    await supabase.from('trusts').update({ active: !active }).eq('id', trustId);
    loadTrusts();
  };

  const handleInviteUser = async () => {
    if (!newUserEmail || !newUserPassword) {
      setInviteStatus('Email and password are required');
      return;
    }
    const trustId = role === 'owner' ? newUserTrust : userTrustId;
    if (!trustId) {
      setInviteStatus('Please select a trust');
      return;
    }
    // Trust admins can only create command users
    const inviteRole = role === 'admin' ? 'command' : newUserRole;

    setInviteStatus('Creating account...');
    try {
      const res = await callAdminApi({
        action: 'invite_user',
        email: newUserEmail,
        password: newUserPassword,
        full_name: newUserName,
        trust_id: trustId,
        role: inviteRole,
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
    window.location.href = '/login';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#F5F5F0' }}>
        <p style={{ color: '#666666', letterSpacing: '0.15em' }}>LOADING...</p>
      </div>
    );
  }

  const auditRows = useMemo(
    () => auditLogs.map((entry) => buildAuditViewModel(entry, auditShiftMeta, auditReportMeta)),
    [auditLogs, auditShiftMeta, auditReportMeta],
  );

  const filteredAuditRows = useMemo(() => {
    const actionRows = auditRows.filter((row) => row.entry.action !== 'incidents_fetched');
    if (!auditFilter.trim()) return auditRows;
    const needle = auditFilter.toLowerCase();
    if (!auditFilter.trim()) return actionRows;
    return actionRows.filter((row) => {
      return (
        row.actor.toLowerCase().includes(needle) ||
        row.actionSummary.toLowerCase().includes(needle) ||
        row.incidentRef.toLowerCase().includes(needle) ||
        row.shiftRef.toLowerCase().includes(needle) ||
        row.detailsSummary.toLowerCase().includes(needle)
      );
    });
  }, [auditRows, auditFilter]);

  const myTrust = trusts.find(t => t.id === userTrustId);

  // Determine which tabs to show
  const ownerTabs: OwnerTab[] = ['trusts', 'users', 'audit', 'devices'];
  const adminTabs: AdminTab[] = ['my-trust', 'users', 'audit', 'devices'];

  return (
    <div className="min-h-screen" style={{ background: '#F5F5F0' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2A3A32' }}>
        <div className="flex items-center gap-4">
          <span className="font-logo" style={{ color: '#1A1A1A', fontSize: 28 }}>
            ACUITY
          </span>
          <span style={{ color: '#8A9B94', fontSize: 12, letterSpacing: '0.15em' }}>
            {role === 'owner' ? 'OWNER ADMIN' : 'TRUST ADMIN'}
          </span>
          {role === 'admin' && myTrust && (
            <span style={{ color: 'hsl(147, 100%, 62%)', fontSize: 12, letterSpacing: '0.1em' }}>
              {myTrust.name}
            </span>
          )}
        </div>
        <button onClick={handleLogout} style={{ ...btnSmall, fontSize: 11 }}>SIGN OUT</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: '#2A3A32' }}>
        {role === 'owner'
          ? ownerTabs.map((t) => (
              <button key={t} onClick={() => setOwnerTab(t)} style={tabStyle(ownerTab === t)}>
                {t.toUpperCase()}
              </button>
            ))
          : adminTabs.map((t) => (
              <button key={t} onClick={() => setAdminTab(t)} style={tabStyle(adminTab === t)}>
                {t === 'my-trust' ? 'MY TRUST' : t.toUpperCase()}
              </button>
            ))
        }
      </div>

      <div className="p-4" style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* ═══════════════ OWNER: TRUSTS TAB ═══════════════ */}
        {role === 'owner' && ownerTab === 'trusts' && (
          <div>
            <div className="mb-6 p-4 rounded" style={{ background: '#FFFFFF', border: '1px solid #E2E2DE' }}>
              <p style={{ color: '#666666', fontSize: 12, letterSpacing: '0.15em', marginBottom: 12 }}>ADD NEW TRUST</p>
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label style={{ color: '#666666', fontSize: 11, display: 'block', marginBottom: 4 }}>NAME</label>
                  <input
                    value={newTrustName}
                    onChange={(e) => setNewTrustName(e.target.value)}
                    placeholder="Trust Name"
                    style={{ ...inputSmall }}
                  />
                </div>
                <div>
                  <label style={{ color: '#666666', fontSize: 11, display: 'block', marginBottom: 4 }}>SLUG</label>
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
                  Generated PIN: <strong>{generatedPin}</strong> — share securely with trust admin
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
                        <span style={{ color: '#FF9500', fontSize: 11, marginLeft: 8 }}>TEST</span>
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
                        <button onClick={() => handleResetPin(t.id)} style={btnSmall}>RESET PIN</button>
                        <button onClick={() => handleToggleTrust(t.id, t.active)} style={btnSmall}>
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

        {/* ═══════════════ TRUST ADMIN: MY TRUST TAB ═══════════════ */}
        {role === 'admin' && adminTab === 'my-trust' && (
          <div>
            {myTrust ? (
              <div className="p-4 rounded" style={{ background: '#FFFFFF', border: '1px solid #E2E2DE' }}>
                <div className="flex justify-between items-start">
                  <div>
                    <p style={{ color: '#666666', fontSize: 12, letterSpacing: '0.15em', marginBottom: 8 }}>TRUST DETAILS</p>
                    <p style={{ color: '#1A1A1A', fontSize: 20, fontWeight: 600, marginBottom: 4 }}>{myTrust.name}</p>
                    <p style={{ color: '#666666', fontSize: 13 }}>Slug: {myTrust.slug}</p>
                    <p style={{ color: '#666666', fontSize: 13 }}>Created: {new Date(myTrust.created_at).toLocaleDateString()}</p>
                    <p style={{ color: myTrust.active ? 'hsl(147, 100%, 62%)' : '#FF3B30', fontSize: 13, marginTop: 4 }}>
                      {myTrust.active ? 'ACTIVE' : 'INACTIVE'}
                    </p>
                  </div>
                  <div>
                    <button onClick={() => handleResetPin(myTrust.id)} style={btnSmall}>RESET CREW PIN</button>
                    {resetPinTrustId === myTrust.id && resetPinValue && (
                      <p style={{ color: 'hsl(147, 100%, 62%)', fontSize: 14, marginTop: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
                        New PIN: <strong>{resetPinValue}</strong>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ color: '#666666' }}>No trust assigned to your account.</p>
            )}
          </div>
        )}

        {/* ═══════════════ USERS TAB (both roles) ═══════════════ */}
        {activeTab === 'users' && (
          <div>
            <div className="mb-6 p-4 rounded" style={{ background: '#FFFFFF', border: '1px solid #E2E2DE' }}>
              <p style={{ color: '#666666', fontSize: 12, letterSpacing: '0.15em', marginBottom: 12 }}>
                {role === 'owner' ? 'ADD NEW USER' : 'ADD COMMAND USER'}
              </p>
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label style={{ color: '#666666', fontSize: 11, display: 'block', marginBottom: 4 }}>EMAIL</label>
                  <input
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="user@trust.nhs.uk"
                    type="email"
                    style={{ ...inputSmall, width: 220 }}
                  />
                </div>
                <div>
                  <label style={{ color: '#666666', fontSize: 11, display: 'block', marginBottom: 4 }}>PASSWORD</label>
                  <input
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Temporary password"
                    type="text"
                    style={{ ...inputSmall, width: 180 }}
                  />
                </div>
                <div>
                  <label style={{ color: '#666666', fontSize: 11, display: 'block', marginBottom: 4 }}>FULL NAME</label>
                  <input
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Optional"
                    style={{ ...inputSmall, width: 160 }}
                  />
                </div>
                {/* Owner picks trust + role; admin has fixed trust and can only create command */}
                {role === 'owner' && (
                  <>
                    <div>
                      <label style={{ color: '#666666', fontSize: 11, display: 'block', marginBottom: 4 }}>TRUST</label>
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
                      <label style={{ color: '#666666', fontSize: 11, display: 'block', marginBottom: 4 }}>ROLE</label>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'command')}
                        style={{ ...inputSmall, width: 150 }}
                      >
                        <option value="admin">Trust Admin</option>
                        <option value="command">Command</option>
                      </select>
                    </div>
                  </>
                )}
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
                  {role === 'owner' && <th style={headerCellStyle}>TRUST</th>}
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
                    {role === 'owner' && (
                      <td style={cellStyle}>
                        {u.trust_id ? trusts.find(t => t.id === u.trust_id)?.name || u.trust_id.slice(0, 8) : '—'}
                      </td>
                    )}
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

        {/* ═══════════════ AUDIT TAB (both roles) ═══════════════ */}
        {activeTab === 'audit' && (
          <div>
            <input
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              placeholder="Filter by crew, action, incident number, shift ID..."
              style={{ ...inputSmall, width: '100%', marginBottom: 16 }}
            />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>TIMESTAMP</th>
                  <th style={headerCellStyle}>EVENT TIME</th>
                  <th style={headerCellStyle}>CREW ID / USER</th>
                  <th style={headerCellStyle}>ACTION</th>
                  <th style={headerCellStyle}>INCIDENT</th>
                  <th style={headerCellStyle}>SHIFT</th>
                  <th style={headerCellStyle}>DETAILS</th>
                  <th style={{ ...headerCellStyle, width: 80 }}>RAW</th>
                </tr>
              </thead>
              <tbody>
                {filteredAuditRows.map((row) => {
                  const a = row.entry;
                  const isExpanded = expandedAuditId === a.id;
                  return (
                    <React.Fragment key={a.id}>
                      <tr
                        onClick={() => setExpandedAuditId(isExpanded ? null : a.id)}
                        style={{ cursor: 'pointer', background: isExpanded ? 'rgba(61, 255, 140, 0.04)' : 'transparent' }}
                      >
                        <td style={cellStyle}>{new Date(a.created_at).toLocaleString()}</td>
                        <td style={cellStyle}>{row.timeRef}</td>
                        <td style={cellStyle}>{row.actor}</td>
                        <td style={cellStyle}>{row.actionSummary}</td>
                        <td style={cellStyle}>{row.incidentRef}</td>
                        <td style={cellStyle}>{row.shiftRef}</td>
                        <td style={cellStyle}>{row.detailsSummary}</td>
                        <td
                          style={{ ...cellStyle, textAlign: 'center', fontSize: 12, color: '#666666' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedAuditId(isExpanded ? null : a.id);
                          }}
                        >
                          {isExpanded ? 'HIDE' : 'SHOW'}
                        </td>
                      </tr>
                      {isExpanded && a.details && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid #E2E2DE' }}>
                            <div style={{
                              padding: '12px 16px',
                              background: '#FFFFFF',
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                              gap: 12,
                            }}>
                              {Object.entries(a.details).map(([key, val]) => (
                                <div key={key} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                  <div style={{ fontSize: 11, color: '#666666', letterSpacing: '0.1em', marginBottom: 2, textTransform: 'uppercase' }}>
                                    {key.replace(/_/g, ' ')}
                                  </div>
                                  <div style={{
                                    fontSize: 13,
                                    color: '#333333',
                                    wordBreak: 'break-all',
                                    background: '#F8F8F5',
                                    border: '1px solid #E2E2DE',
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
                          <td colSpan={8} style={{ ...cellStyle, color: '#666666', fontStyle: 'italic' }}>
                            No details available
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredAuditRows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...cellStyle, textAlign: 'center', color: '#666666' }}>
                      No audit entries found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════ DEVICES TAB (both roles) ═══════════════ */}
        {activeTab === 'devices' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {role === 'owner' && <th style={headerCellStyle}>TRUST</th>}
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
                  {role === 'owner' && <td style={cellStyle}>{s.trust_name || '—'}</td>}
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
