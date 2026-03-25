import { useState, useCallback, useEffect, useRef } from 'react';
import type { Assessment, LiveState, Mismatch, ActionItem } from '@/lib/herald-types';
import { TEST_TRANSMISSIONS, PRIORITY_COLORS, SERVICE_LABELS, detectMismatches } from '@/lib/herald-types';
import { transcribeAudio, assessTranscript, syncReport } from '@/lib/herald-api';
import { getReports, markSynced, saveReport, updateReport } from '@/lib/herald-storage';
import { computeDiff } from '@/lib/herald-diff';
import { getSession } from '@/lib/herald-session';
import { toSyncPayload } from '@/lib/herald-sync';
import type { HeraldReport } from '@/lib/herald-types';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeAssessment, toActionItems, formatActionAge } from '@/lib/sanitize-assessment';

const MAX_DURATION_MS = 5 * 60 * 1000;

function getLocation(): Promise<{ lat?: number; lng?: number; location_accuracy?: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, location_accuracy: pos.coords.accuracy }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}

function getSupportedMimeType(): string {
  const types = ['audio/webm', 'audio/ogg', 'audio/wav'];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getSessionFields() {
  const session = getSession();
  if (!session) return {};
  return {
    session_callsign: session.callsign,
    session_operator_id: session.operator_id ?? undefined,
    session_service: session.service,
    session_station: session.station ?? undefined,
    vehicle_type: session.vehicle_type ?? undefined,
    can_transport: session.can_transport ?? true,
    critical_care: session.critical_care ?? false,
  };
}

interface LiveTabProps {
  onAiStatus: (s: 'ok' | 'error') => void;
  onReportSaved: () => void;
}

export function LiveTab({ onAiStatus, onReportSaved }: LiveTabProps) {
  const [state, setState] = useState<LiveState>('idle');
  const [transcript, setTranscript] = useState('');
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState('');
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [capturedDuration, setCapturedDuration] = useState(0);
  const [maxReached, setMaxReached] = useState(false);

  const [editHeadline, setEditHeadline] = useState('');
  const [editStructured, setEditStructured] = useState<Record<string, string>>({});
  const [editActions, setEditActions] = useState<string[]>([]);
  const [editFormattedReport, setEditFormattedReport] = useState('');
  const [originalAssessment, setOriginalAssessment] = useState<Assessment | null>(null);
  const [hasEdits, setHasEdits] = useState(false);
  const [mismatches] = useState<Mismatch[]>([]);
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [followUpReportId, setFollowUpReportId] = useState<string | null>(null);
  const [followUpIncidentNumber, setFollowUpIncidentNumber] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef('');
  const recordingStartRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReportRef = useRef<{ id: string; timestamp: string; transcript: string; lat?: number; lng?: number; location_accuracy?: number } | null>(null);
  const lastSubmissionRef = useRef<{ content: string; callsign: string; timestamp: number } | null>(null);

  const syncNow = useCallback(async (reportId: string) => {
    try {
      const report = getReports().find((r) => r.id === reportId);
      if (!report) return;

      const ok = await syncReport(toSyncPayload(report));
      if (ok) {
        markSynced(reportId);
      }
    } catch {
      // interval sync will retry
    }
  }, []);

  useEffect(() => {
    if (assessment && state === 'ready') {
      // Sanitize assessment before populating edit fields
      const clean = sanitizeAssessment(assessment);
      setEditHeadline(clean.headline || '');
      const flatStructured: Record<string, string> = {};
      for (const [k, v] of Object.entries(clean.structured || {})) {
        if (v === null || v === undefined) {
          flatStructured[k] = '';
        } else if (typeof v === 'object') {
          flatStructured[k] = JSON.stringify(v, null, 0);
        } else {
          flatStructured[k] = String(v);
        }
      }
      setEditStructured(flatStructured);

      // Override structured callsign/operator_id with session values
      const currentSession = getSession();
      if (currentSession) {
        if (currentSession.callsign) {
          flatStructured['callsign'] = currentSession.callsign;
        }
        if (currentSession.operator_id) {
          flatStructured['operator_id'] = currentSession.operator_id;
        }
      }
      setEditStructured(flatStructured);

      setEditActions([...(clean.actions || [])]);
      setEditFormattedReport(clean.formatted_report || '');
      setOriginalAssessment(JSON.parse(JSON.stringify(clean)));

      // Check for existing incident (follow-up detection)
      // Priority: 1) incident_number match, 2) callsign + context + 30min window
      const incidentNum = assessment.structured?.incident_number;
      const txCallsign = assessment.structured?.callsign;
      const txIncidentType = assessment.incident_type;
      const txLocation = assessment.scene_location;
      const shiftId = currentSession?.shift_id;
      const sessionCallsign = currentSession?.callsign;
      const effectiveCallsign = (txCallsign && txCallsign !== 'null') ? txCallsign : sessionCallsign;

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const findFollowUp = async () => {
        // 1) Try exact incident_number match first
        if (incidentNum && incidentNum !== 'null' && incidentNum !== '') {
          const query = supabase
            .from('herald_reports')
            .select('id, incident_number')
            .eq('incident_number', incidentNum)
            .eq('status', 'active')
            .limit(1);
          if (shiftId) query.eq('shift_id', shiftId);
          else query.gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString());

          const { data } = await query;
          if (data && data.length > 0) {
            return { reportId: data[0].id, incNum: incidentNum };
          }
        }

        // 2) Contextual match: callsign + (incident_type OR scene_location) + 30min window
        if (effectiveCallsign && effectiveCallsign !== 'null') {
          const query = supabase
            .from('herald_reports')
            .select('id, incident_number, assessment, latest_transmission_at, created_at')
            .eq('status', 'active')
            .eq('session_callsign', effectiveCallsign)
            .gte('latest_transmission_at', thirtyMinAgo)
            .order('latest_transmission_at', { ascending: false })
            .limit(5);
          if (shiftId) query.eq('shift_id', shiftId);

          const { data } = await query;
          if (data && data.length > 0) {
            // Score each candidate by context overlap
            for (const candidate of data) {
              const cAssessment = candidate.assessment as any;
              if (!cAssessment) continue;

              const typeMatch = txIncidentType && cAssessment.incident_type &&
                txIncidentType.toLowerCase() === cAssessment.incident_type.toLowerCase();
              const locationMatch = txLocation && cAssessment.scene_location &&
                txLocation.toLowerCase() === cAssessment.scene_location.toLowerCase();

              // Also check if created_at is within 30min as fallback for records without latest_transmission_at
              const cTime = candidate.latest_transmission_at || candidate.created_at;
              const withinWindow = cTime && (Date.now() - new Date(cTime).getTime()) < 30 * 60 * 1000;

              if (withinWindow && (typeMatch || locationMatch)) {
                return { reportId: candidate.id, incNum: incidentNum || candidate.incident_number || null };
              }
            }

            // If only one candidate within window with same callsign, still match
            const withinWindow = data.filter(c => {
              const t = c.latest_transmission_at || c.created_at;
              return t && (Date.now() - new Date(t).getTime()) < 30 * 60 * 1000;
            });
            if (withinWindow.length === 1) {
              return { reportId: withinWindow[0].id, incNum: incidentNum || withinWindow[0].incident_number || null };
            }
          }
        }

        return null;
      };

      findFollowUp().then((match) => {
        if (match) {
          setIsFollowUp(true);
          setFollowUpReportId(match.reportId);
          setFollowUpIncidentNumber(match.incNum ?? null);
        } else {
          setIsFollowUp(false);
          setFollowUpReportId(null);
          setFollowUpIncidentNumber(incidentNum && incidentNum !== 'null' ? incidentNum : null);
        }
      });
    }
  }, [assessment, state]);

  const buildFinalAssessment = useCallback((): Assessment => {
    return {
      ...assessment!,
      headline: editHeadline,
      structured: { ...editStructured },
      actions: [...editActions],
      formatted_report: editFormattedReport,
    };
  }, [assessment, editHeadline, editStructured, editActions, editFormattedReport]);

  useEffect(() => {
    if (!originalAssessment || !assessment) return;
    const current = buildFinalAssessment();
    const diff = computeDiff(originalAssessment, current);
    setHasEdits(diff.has_edits);
  }, [editHeadline, editStructured, editActions, editFormattedReport, originalAssessment, assessment, buildFinalAssessment]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [editFormattedReport]);

  const cleanupRecording = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }
      const mime = getSupportedMimeType();
      mimeTypeRef.current = mime;
      const recorder = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : {});
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000);
      recordingStartRef.current = Date.now();
      setRecordingDuration(0);
      setMaxReached(false);

      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(Date.now() - recordingStartRef.current);
      }, 200);

      maxTimerRef.current = setTimeout(() => {
        setMaxReached(true);
        setTimeout(() => stopRecordingAndProcess(), 1000);
      }, MAX_DURATION_MS);

      setState('recording');
    } catch {
      setError('Microphone access denied');
      setTimeout(() => setError(''), 3000);
    }
  }, []);

  const stopRecordingAndProcess = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    const duration = Date.now() - recordingStartRef.current;
    setCapturedDuration(duration);
    cleanupRecording();

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        setState('processing');
        try {
          const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
          const base64 = await blobToBase64(blob);

      const t = await transcribeAudio(base64);

          // Deduplication: skip if same content + callsign within 30s
          const sessionCtx = getSession();
          const dedupCallsign = sessionCtx?.callsign || '';
          const lastSub = lastSubmissionRef.current;
          if (lastSub && lastSub.content === t && lastSub.callsign === dedupCallsign && (Date.now() - lastSub.timestamp) < 30000) {
            console.log('Duplicate transmission discarded (audio)');
            setState('idle');
            return;
          }

          setTranscript(t);
          const result = await assessTranscript(t, { vehicle_type: sessionCtx?.vehicle_type, can_transport: sessionCtx?.can_transport });
          // Override callsign and operator_id from shift data — never from transcript
          if (result && result.structured) {
            result.structured.callsign = sessionCtx?.callsign || null;
            result.structured.operator_id = sessionCtx?.operator_id || null;
          }
          setAssessment(result);
          onAiStatus('ok');

          const loc = await getLocation();
          const reportId = crypto.randomUUID();
          setCurrentReportId(reportId);
          pendingReportRef.current = {
            id: reportId,
            timestamp: new Date().toISOString(),
            transcript: t,
            ...loc,
          };
          lastSubmissionRef.current = { content: t, callsign: dedupCallsign, timestamp: Date.now() };
          setState('ready');
        } catch {
          onAiStatus('error');
          setError('Intelligence assessment failed');
          setTimeout(() => {
            setError('');
            setState('idle');
          }, 3000);
        }
        resolve();
      };
      recorder.stop();
    });
  }, [cleanupRecording, onAiStatus, onReportSaved, syncNow]);

  const processTestTransmission = useCallback(async (text: string) => {
    setState('processing');
    setTranscript('');
    setAssessment(null);
    setCurrentReportId(null);
    setOriginalAssessment(null);
    setHasEdits(false);
    setCapturedDuration(0);
    setError('');

    try {
      const sessionCtx = getSession();

      // Deduplication: skip if same content + callsign within 30s
      const dedupCallsign = sessionCtx?.callsign || '';
      const lastSub = lastSubmissionRef.current;
      if (lastSub && lastSub.content === text && lastSub.callsign === dedupCallsign && (Date.now() - lastSub.timestamp) < 30000) {
        console.log('Duplicate transmission discarded (test)');
        setState('idle');
        return;
      }

      setTranscript(text);
      const result = await assessTranscript(text, { vehicle_type: sessionCtx?.vehicle_type, can_transport: sessionCtx?.can_transport });
      // Override callsign and operator_id from shift data — never from transcript
      if (result && result.structured) {
        result.structured.callsign = sessionCtx?.callsign || null;
        result.structured.operator_id = sessionCtx?.operator_id || null;
      }
      setAssessment(result);
      onAiStatus('ok');

      const loc = await getLocation();
      const reportId = crypto.randomUUID();
      setCurrentReportId(reportId);
      pendingReportRef.current = {
        id: reportId,
        timestamp: new Date().toISOString(),
        transcript: text,
        ...loc,
      };
      lastSubmissionRef.current = { content: text, callsign: dedupCallsign, timestamp: Date.now() };
      setState('ready');
    } catch {
      onAiStatus('error');
      setError('Intelligence assessment failed');
      setTimeout(() => {
        setError('');
        setState('idle');
      }, 3000);
    }
  }, [onAiStatus, onReportSaved, syncNow]);

  const handleConfirm = useCallback(async () => {
    if (!assessment || !currentReportId || !originalAssessment || !pendingReportRef.current) return;
    const finalAssessment = buildFinalAssessment();
    const diff = computeDiff(originalAssessment, finalAssessment);

    const loc = await getLocation();
    const sessionFields = getSessionFields();
    const pending = pendingReportRef.current;

    const report: HeraldReport = {
      id: pending.id,
      timestamp: pending.timestamp,
      transcript: pending.transcript,
      assessment: finalAssessment as unknown as Assessment,
      synced: false,
      confirmed_at: new Date().toISOString(),
      headline: finalAssessment.headline,
      priority: finalAssessment.priority,
      service: finalAssessment.service,
      lat: loc.lat ?? pending.lat,
      lng: loc.lng ?? pending.lng,
      location_accuracy: loc.location_accuracy ?? pending.location_accuracy,
      original_assessment: originalAssessment as any,
      final_assessment: finalAssessment as any,
      diff: { ...diff, mismatches } as any,
      edited: diff.has_edits,
      incident_number: followUpIncidentNumber ?? undefined,
      status: 'active' as const,
      ...sessionFields,
    };

    if (isFollowUp && followUpReportId) {
      // Update existing parent report in local storage instead of creating a duplicate
      updateReport(followUpReportId, {
        assessment: finalAssessment as unknown as Assessment,
        headline: finalAssessment.headline,
        priority: finalAssessment.priority,
        latest_transmission_at: report.timestamp,
        transmission_count: undefined, // we don't track this locally precisely
      });
    } else {
      saveReport(report);
    }

    // Sync with follow-up awareness
    try {
      const payload = toSyncPayload(report, isFollowUp && followUpReportId ? followUpReportId : undefined);
      const ok = await syncReport(payload);
      if (ok) markSynced(report.id);
    } catch {
      // interval sync will retry
    }

    onReportSaved();
    pendingReportRef.current = null;
    setIsFollowUp(false);
    setFollowUpReportId(null);
    setFollowUpIncidentNumber(null);
    setState('confirmed');
  }, [assessment, currentReportId, onReportSaved, originalAssessment, buildFinalAssessment, mismatches, isFollowUp, followUpReportId, followUpIncidentNumber]);

  const handleDiscard = useCallback(() => {
    setState('idle');
    setAssessment(null);
    setTranscript('');
    setCurrentReportId(null);
    setOriginalAssessment(null);
    setHasEdits(false);
    
    setIsFollowUp(false);
    setFollowUpReportId(null);
    setFollowUpIncidentNumber(null);
    pendingReportRef.current = null;
  }, []);

  // ─── STATE 1: IDLE & STATE 2: RECORDING (same layout) ───
  // Optimized for 720×1280 portrait touchscreen (5" handheld radio/Android)
  if (state === 'idle' || state === 'recording') {
    const isRecording = state === 'recording';
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-6">
        {isRecording && (
          <div
            className="fixed top-0 left-0 right-0 z-50 overflow-hidden"
            style={{ height: 3, background: 'rgba(255,59,48,0.2)' }}
          >
            <div
              className="h-full"
              style={{
                width: '40%',
                background: '#FF3B30',
                animation: 'shimmer 1.5s ease-in-out infinite',
              }}
            />
          </div>
        )}

        {isRecording && maxReached && (
          <p className="mb-4" style={{ color: '#FF9500', fontSize: 22, letterSpacing: '0.2em', fontWeight: 700 }}>
            MAX DURATION REACHED
          </p>
        )}

        <button
          onClick={isRecording ? stopRecordingAndProcess : startRecording}
          className="flex items-center justify-center rounded-full"
          style={{
            width: 280,
            height: 280,
            background: isRecording ? '#FF3B30' : '#CC0000',
            boxShadow: isRecording
              ? '0 0 60px rgba(255,59,48,0.5), 0 0 120px rgba(255,59,48,0.2)'
              : '0 0 40px rgba(204,0,0,0.4), 0 0 80px rgba(204,0,0,0.15)',
            border: 'none',
            transition: 'box-shadow 0.3s ease',
          }}
        >
          <span style={{ color: '#FFFFFF', fontSize: 28, letterSpacing: '0.25em', fontWeight: 700 }}>
            {isRecording ? 'END' : 'START'}
          </span>
        </button>

        {isRecording ? (
          <>
            <p style={{ color: '#FF3B30', fontSize: 28, fontVariantNumeric: 'tabular-nums', marginTop: 20 }}>
              {formatDuration(recordingDuration)}
            </p>
            <p style={{ color: '#FFFFFF', fontSize: 20, letterSpacing: '0.2em', marginTop: 12, fontWeight: 700 }}>
              TAP TO STOP AND PROCESS
            </p>
          </>
        ) : (
          <>
            <p style={{ color: '#FFFFFF', fontSize: 20, letterSpacing: '0.2em', marginTop: 28, textAlign: 'center', fontWeight: 700 }}>
              TAP TO START RECORDING
            </p>
            {error && (
              <p className="mt-3" style={{ color: '#FF9500', fontSize: 20, letterSpacing: '0.2em' }}>{error}</p>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── STATE 3: PROCESSING ───
  if (state === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-6">
        <div
          className="animate-spin-herald rounded-full"
          style={{
            width: 64,
            height: 64,
            border: '3px solid #0F1820',
            borderTopColor: '#3DFF8C',
          }}
        />
        <p style={{ color: '#1E3028', fontSize: 22, letterSpacing: '0.2em', marginTop: 24, textAlign: 'center' }}>
          RUNNING INTELLIGENCE ASSESSMENT
        </p>
        {capturedDuration > 0 && (
          <p style={{ color: '#1E3028', fontSize: 20, marginTop: 12 }}>
            CAPTURED: {formatDuration(capturedDuration)}
          </p>
        )}
        {transcript && (
          <div
            className="mt-6 mx-4"
            style={{
              border: '1px solid #0F1820',
              padding: 16,
              borderRadius: 8,
              maxWidth: 600,
            }}
          >
            <p className="line-clamp-4 text-center" style={{ color: '#2A4038', fontSize: 20, fontStyle: 'italic' }}>
              "{transcript}"
            </p>
          </div>
        )}
        {error && (
          <p className="mt-3" style={{ color: '#FF9500', fontSize: 20 }}>{error}</p>
        )}
      </div>
    );
  }

  // ─── STATE 4: READY ───
  if (state === 'ready' && assessment) {
    const pc = PRIORITY_COLORS[assessment.priority] || 'hsl(var(--foreground))';

    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Transcript display */}
        <div className="flex-1 overflow-auto px-6 pt-8 pb-4">
          {isFollowUp && followUpIncidentNumber && (
            <div className="mb-5 p-4 rounded-lg border" style={{ background: 'rgba(30,144,255,0.08)', borderColor: '#1E90FF' }}>
              <p style={{ fontSize: 22, fontWeight: 700, color: '#1E90FF', letterSpacing: '0.15em' }}>
                🔄 FOLLOW-UP — Incident #{followUpIncidentNumber}
              </p>
            </div>
          )}

          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.15em', color: pc, marginBottom: 16 }}>TRANSCRIPT</p>
          <div className="p-5 rounded-lg border border-border bg-card">
            <p style={{ fontSize: 22, lineHeight: 1.6, fontStyle: 'italic', color: 'hsl(var(--foreground))' }}>
              "{transcript}"
            </p>
          </div>

          {capturedDuration > 0 && (
            <p style={{ fontSize: 20, color: 'hsl(var(--foreground))', opacity: 0.5, marginTop: 16, textAlign: 'center' }}>
              Duration: {formatDuration(capturedDuration)}
            </p>
          )}
        </div>

        {/* Bottom buttons — large touch targets for 5" screen */}
        <div className="px-6 pb-16 pt-3 flex flex-col gap-4" style={{ background: 'hsl(var(--background))' }}>
          <button
            onClick={handleConfirm}
            className="w-full font-heading font-bold rounded-lg"
            style={{
              fontSize: 24,
              letterSpacing: '0.15em',
              padding: '20px 0',
              background: `${pc}1A`,
              border: `2px solid ${pc}`,
              color: pc,
              boxShadow: `0 0 24px ${pc}33`,
            }}
          >✦ HERALD</button>
          <button
            onClick={handleDiscard}
            className="w-full font-heading font-bold rounded-lg bg-transparent border border-border text-foreground opacity-70"
            style={{
              fontSize: 22,
              letterSpacing: '0.15em',
              padding: '16px 0',
            }}
          >DISMISS</button>
        </div>
      </div>
    );
  }

  // ─── STATE 5: CONFIRMED ───
  if (state === 'confirmed') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-6">
        <button
          onClick={() => setState('idle')}
          className="w-full font-heading font-bold rounded-lg"
          style={{
            fontSize: 24,
            letterSpacing: '0.15em',
            padding: '20px 0',
            background: 'rgba(61,255,140,0.06)',
            border: '1px solid rgba(61,255,140,0.2)',
            color: 'hsl(var(--primary))',
            maxWidth: 480,
          }}
        >✓ HERALDED — RETURN TO LISTEN</button>
      </div>
    );
  }

  return null;
}
