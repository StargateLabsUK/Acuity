import { useState, useCallback, useEffect, useRef } from 'react';
import type { Assessment, LiveState, Mismatch, ActionItem } from '@/lib/herald-types';
import { TEST_TRANSMISSIONS, PRIORITY_COLORS, SERVICE_LABELS, detectMismatches } from '@/lib/herald-types';
import { transcribeAudio, assessTranscript, syncReport } from '@/lib/herald-api';
import { enqueue } from '@/lib/offline-queue';
import { getReports, markSynced, saveReport, updateReport } from '@/lib/herald-storage';
import { computeDiff } from '@/lib/herald-diff';
import { getSession } from '@/lib/herald-session';
import { toSyncPayload } from '@/lib/herald-sync';
import type { HeraldReport } from '@/lib/herald-types';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeAssessment, toActionItems, formatActionAge } from '@/lib/sanitize-assessment';

async function fetchExistingAtmist(callsign: string | undefined, shiftId: string | undefined): Promise<Record<string, any> | undefined> {
  if (!callsign) return undefined;
  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const query = supabase
      .from('herald_reports')
      .select('assessment')
      .eq('status', 'active')
      .eq('session_callsign', callsign)
      .gte('latest_transmission_at', thirtyMinAgo)
      .order('latest_transmission_at', { ascending: false })
      .limit(1);
    if (shiftId) query.eq('shift_id', shiftId);
    const { data } = await query;
    if (data && data.length > 0) {
      const assessment = data[0].assessment as any;
      if (assessment?.atmist && Object.keys(assessment.atmist).length > 0) {
        return assessment.atmist;
      }
    }
  } catch {
    // Non-critical — proceed without context
  }
  return undefined;
}

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

async function getSessionFields() {
  const session = await getSession();
  if (!session) return {};
  return {
    session_callsign: session.callsign,
    session_operator_id: session.operator_id ?? undefined,
    session_service: session.service,
    session_station: session.station ?? undefined,
    vehicle_type: session.vehicle_type ?? undefined,
    can_transport: session.can_transport ?? true,
    critical_care: session.critical_care ?? false,
    shift_id: session.shift_id ?? undefined,
  };
}

interface LiveTabProps {
  onAiStatus: (s: 'ok' | 'error') => void;
  onReportSaved: () => void;
  autoSend?: boolean;
}

export function LiveTab({ onAiStatus, onReportSaved, autoSend }: LiveTabProps) {
  const [state, setState] = useState<LiveState>('idle');
  const [transcript, setTranscript] = useState('');
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState('');
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [capturedDuration, setCapturedDuration] = useState(0);
  const [maxReached, setMaxReached] = useState(false);
  const [sendCount, setSendCount] = useState(0);

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
      const report = (await getReports()).find((r) => r.id === reportId);
      if (!report) return;

      const ok = await syncReport(await toSyncPayload(report));
      if (ok) {
        await markSynced(reportId);
      }
    } catch {
      // interval sync will retry
    }
  }, []);

  /** Auto-send: save report immediately without user review, return to idle */
  const autoSaveReport = useCallback(async (
    reportTranscript: string,
    reportAssessment: Assessment,
    reportId: string,
    loc: { lat?: number; lng?: number; location_accuracy?: number },
    followUp?: { reportId: string; incidentNumber?: string | null },
  ) => {
    const clean = sanitizeAssessment(reportAssessment);
    const sessionFields = await getSessionFields();

    const report: HeraldReport = {
      id: reportId,
      timestamp: new Date().toISOString(),
      transcript: reportTranscript,
      assessment: clean as unknown as Assessment,
      synced: false,
      confirmed_at: new Date().toISOString(),
      headline: clean.headline,
      priority: clean.priority,
      service: clean.service,
      lat: loc.lat,
      lng: loc.lng,
      location_accuracy: loc.location_accuracy,
      original_assessment: clean as any,
      final_assessment: clean as any,
      diff: { has_edits: false } as any,
      edited: false,
      incident_number: followUp?.incidentNumber ?? undefined,
      status: 'active' as const,
      ...sessionFields,
    };

    if (followUp?.reportId) {
      await updateReport(followUp.reportId, {
        assessment: clean as unknown as Assessment,
        headline: clean.headline,
        priority: clean.priority,
        latest_transmission_at: report.timestamp,
        transmission_count: undefined,
      });
    } else {
      await saveReport(report);
    }

    try {
      const payload = await toSyncPayload(report, followUp?.reportId);
      const ok = await syncReport(payload);
      if (ok) await markSynced(report.id);
    } catch {
      // interval sync will retry
    }

    onReportSaved();
    setSendCount(c => c + 1);
    setState('confirmed');
    setTimeout(() => setState('idle'), 2000);
  }, [onReportSaved]);

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

      setEditActions([...(clean.actions || [])]);
      setEditFormattedReport(clean.formatted_report || '');
      setOriginalAssessment(JSON.parse(JSON.stringify(clean)));

      // Check for existing incident (follow-up detection)
      // Priority: 1) incident_number match, 2) callsign + context + 30min window
      const incidentNum = assessment.structured?.incident_number;
      const txCallsign = assessment.structured?.callsign;
      const txIncidentType = assessment.incident_type;
      const txLocation = assessment.scene_location;

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const initAsync = async () => {
        // Override structured callsign/operator_id with session values
        const currentSession = await getSession();
        if (currentSession) {
          if (currentSession.callsign) {
            flatStructured['callsign'] = currentSession.callsign;
          }
          if (currentSession.operator_id) {
            flatStructured['operator_id'] = currentSession.operator_id;
          }
        }
        setEditStructured({ ...flatStructured });

        const shiftId = currentSession?.shift_id;
        const sessionCallsign = currentSession?.callsign;
        const effectiveCallsign = (txCallsign && txCallsign !== 'null') ? txCallsign : sessionCallsign;

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
      };

      initAsync();
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
          const sessionCtx = await getSession();
          const dedupCallsign = sessionCtx?.callsign || '';
          const lastSub = lastSubmissionRef.current;
          if (lastSub && lastSub.content === t && lastSub.callsign === dedupCallsign && (Date.now() - lastSub.timestamp) < 30000) {
            // Duplicate — skip
            setState('idle');
            return;
          }

          setTranscript(t);

          let result: any = null;
          let aiOk = true;
          try {
            const existingAtmist = await fetchExistingAtmist(sessionCtx?.callsign, sessionCtx?.shift_id);
            result = await assessTranscript(t, { vehicle_type: sessionCtx?.vehicle_type, can_transport: sessionCtx?.can_transport, existing_atmist: existingAtmist });
            // Override callsign and operator_id from shift data — never from transcript
            if (result && result.structured) {
              result.structured.callsign = sessionCtx?.callsign || null;
              result.structured.operator_id = sessionCtx?.operator_id || null;
            }
          } catch {
            aiOk = false;
          }

          if (!aiOk || !result) {
            // AI failed — build a minimal fallback so transcript is still saved
            onAiStatus('error');
            result = {
              service: 'unknown',
              protocol: 'NONE',
              priority: null,
              priority_label: null,
              headline: t.substring(0, 80),
              incident_type: 'Unknown',
              major_incident: false,
              scene_location: null,
              receiving_hospital: [],
              clinical_findings: { A: 'Not assessed', B: 'Not assessed', C: 'Not assessed', D: 'Not assessed', E: 'Not assessed' },
              atmist: {},
              treatment_given: [],
              action_items: [],
              structured: { callsign: sessionCtx?.callsign || null, incident_number: null, operator_id: sessionCtx?.operator_id || null },
              actions: ['AI assessment unavailable — review transcript manually'],
              formatted_report: t,
              clinical_history: '',
            };
          } else {
            onAiStatus('ok');
          }

          setAssessment(result);
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
          if (autoSend) {
            await autoSaveReport(t, result, reportId, loc);
            resolve();
            return;
          }
          setState('ready');
        } catch (err: any) {
          // Transcription or processing failed — retry once automatically
          try {
            const retryBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
            const retryBase64 = await blobToBase64(retryBlob);
            const retryT = await transcribeAudio(retryBase64);
            if (retryT) {
              setTranscript(retryT);
              const sessionRetry = await getSession();
              let retryResult: any = null;
              try {
                const existingAtmist = await fetchExistingAtmist(sessionRetry?.callsign, sessionRetry?.shift_id);
                retryResult = await assessTranscript(retryT, { vehicle_type: sessionRetry?.vehicle_type, can_transport: sessionRetry?.can_transport, existing_atmist: existingAtmist });
                if (retryResult?.structured) {
                  retryResult.structured.callsign = sessionRetry?.callsign || null;
                  retryResult.structured.operator_id = sessionRetry?.operator_id || null;
                }
                onAiStatus('ok');
              } catch {
                onAiStatus('error');
                retryResult = {
                  service: 'unknown', protocol: 'NONE', priority: null, priority_label: null,
                  headline: retryT.substring(0, 80), incident_type: 'Unknown', major_incident: false,
                  scene_location: null, receiving_hospital: [], clinical_findings: { A: 'Not assessed', B: 'Not assessed', C: 'Not assessed', D: 'Not assessed', E: 'Not assessed' },
                  atmist: {}, treatment_given: [], action_items: [],
                  structured: { callsign: sessionRetry?.callsign || null, incident_number: null, operator_id: sessionRetry?.operator_id || null },
                  actions: ['AI assessment unavailable — review transcript manually'], formatted_report: retryT, clinical_history: '',
                };
              }
              setAssessment(retryResult);
              const loc = await getLocation();
              const reportId = crypto.randomUUID();
              setCurrentReportId(reportId);
              pendingReportRef.current = { id: reportId, transcript: retryT, assessment: retryResult, lat: loc?.lat, lng: loc?.lng, accuracy: loc?.accuracy };
              lastSubmissionRef.current = { content: retryT, callsign: sessionRetry?.callsign || '', timestamp: Date.now() };
              if (autoSend) {
                await autoSaveReport(retryT, retryResult, reportId, loc);
                resolve();
                return;
              }
              setState('ready');
              resolve();
              return;
            }
          } catch { /* retry also failed */ }

          // If offline, queue audio for later processing instead of showing error
          if (!navigator.onLine) {
            try {
              const offlineBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
              const offlineBase64 = await blobToBase64(offlineBlob);
              const offlineSession = await getSession();
              await enqueue('transcribe', {
                audio_base64: offlineBase64,
                mime_type: mimeTypeRef.current || 'audio/webm',
                report_id: crypto.randomUUID(),
                session_data: offlineSession ? { callsign: offlineSession.callsign, operator_id: offlineSession.operator_id, service: offlineSession.service, station: offlineSession.station } : null,
                vehicle_type: offlineSession?.vehicle_type ?? null,
                can_transport: offlineSession?.can_transport ?? true,
              });
              setError('Offline — recording queued, will process when back online');
              setTimeout(() => { setError(''); setState('idle'); }, 4000);
              resolve();
              return;
            } catch { /* queue failed too */ }
          }

          onAiStatus('error');
          setError('Processing failed — tap RECORD to try again');
          setTimeout(() => {
            setError('');
            setState('idle');
          }, 5000);
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
      const sessionCtx = await getSession();

      // Deduplication: skip if same content + callsign within 30s
      const dedupCallsign = sessionCtx?.callsign || '';
      const lastSub = lastSubmissionRef.current;
      if (lastSub && lastSub.content === text && lastSub.callsign === dedupCallsign && (Date.now() - lastSub.timestamp) < 30000) {
        // Duplicate — skip
        setState('idle');
        return;
      }

      setTranscript(text);

      let result: any = null;
      let aiOk = true;
      try {
        const existingAtmist = await fetchExistingAtmist(sessionCtx?.callsign, sessionCtx?.shift_id);
        result = await assessTranscript(text, { vehicle_type: sessionCtx?.vehicle_type, can_transport: sessionCtx?.can_transport, existing_atmist: existingAtmist });
        if (result && result.structured) {
          result.structured.callsign = sessionCtx?.callsign || null;
          result.structured.operator_id = sessionCtx?.operator_id || null;
        }
      } catch {
        aiOk = false;
      }

      if (!aiOk || !result) {
        onAiStatus('error');
        result = {
          service: 'unknown',
          protocol: 'NONE',
          priority: null,
          priority_label: null,
          headline: text.substring(0, 80),
          incident_type: 'Unknown',
          major_incident: false,
          scene_location: null,
          receiving_hospital: [],
          clinical_findings: { A: 'Not assessed', B: 'Not assessed', C: 'Not assessed', D: 'Not assessed', E: 'Not assessed' },
          atmist: {},
          treatment_given: [],
          action_items: [],
          structured: { callsign: sessionCtx?.callsign || null, incident_number: null, operator_id: sessionCtx?.operator_id || null },
          actions: ['AI assessment unavailable — review transcript manually'],
          formatted_report: text,
          clinical_history: '',
        };
      } else {
        onAiStatus('ok');
      }

      setAssessment(result);
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
      if (autoSend) {
        await autoSaveReport(text, result, reportId, loc);
        return;
      }
      setState('ready');
    } catch (e) {
      onAiStatus('error');
      setError('Processing failed');
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
    const sessionFields = await getSessionFields();
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
      await updateReport(followUpReportId, {
        assessment: finalAssessment as unknown as Assessment,
        headline: finalAssessment.headline,
        priority: finalAssessment.priority,
        latest_transmission_at: report.timestamp,
        transmission_count: undefined, // we don't track this locally precisely
      });
    } else {
      await saveReport(report);
    }

    // Sync with follow-up awareness
    try {
      const payload = await toSyncPayload(report, isFollowUp && followUpReportId ? followUpReportId : undefined);
      const ok = await syncReport(payload);
      if (ok) await markSynced(report.id);
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

  // ─── STATES 1-3: IDLE, RECORDING, PROCESSING ───
  if (state === 'idle' || state === 'recording' || state === 'processing') {
    const isRecording = state === 'recording';
    const isProcessing = state === 'processing';

    const handleButtonClick = () => {
      if (isProcessing) return;
      if (isRecording) stopRecordingAndProcess();
      else startRecording();
    };

    return (
      <div className="flex flex-col items-center flex-1 px-6" style={{ position: 'relative' }}>
        {isRecording && (
          <div
            className="fixed top-0 left-0 right-0 z-50 overflow-hidden"
            style={{ height: 3, background: 'rgba(255,59,48,0.2)' }}
          >
            <div
              className="h-full"
              style={{ width: '40%', background: '#FF3B30', animation: 'shimmer 1.5s ease-in-out infinite' }}
            />
          </div>
        )}

        {/* Top area — status text above button */}
        <div className="flex flex-col items-center justify-end" style={{ height: 'calc(50% - 150px)', paddingBottom: 24 }}>
          {isRecording && maxReached && (
            <p style={{ color: '#FF9500', fontSize: 22, letterSpacing: '0.2em', fontWeight: 700 }}>
              MAX DURATION REACHED
            </p>
          )}
          {isRecording && (
            <p style={{ color: '#FF3B30', fontSize: 32, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
              {formatDuration(recordingDuration)}
            </p>
          )}
          {isProcessing && capturedDuration > 0 && (
            <p style={{ color: '#C8D0CC', fontSize: 20, fontWeight: 700 }}>
              CAPTURED: {formatDuration(capturedDuration)}
            </p>
          )}
        </div>

        {/* Button — always centered */}
        <div style={{ position: 'relative', width: 280, height: 280, flexShrink: 0 }}>
          {isProcessing && (
            <div
              className="absolute rounded-full"
              style={{
                inset: -8,
                border: '4px solid rgba(255,255,255,0.15)',
                borderTopColor: '#FFFFFF',
                animation: 'pulse-ring 2s ease-in-out infinite',
              }}
            />
          )}
          <button
            onClick={handleButtonClick}
            disabled={isProcessing}
            className="flex items-center justify-center rounded-full"
            style={{
              width: 280,
              height: 280,
              background: isProcessing ? '#8B0000' : isRecording ? '#FF3B30' : '#CC0000',
              boxShadow: isProcessing
                ? '0 0 60px rgba(139,0,0,0.5), 0 0 120px rgba(139,0,0,0.2)'
                : isRecording
                  ? '0 0 60px rgba(255,59,48,0.5), 0 0 120px rgba(255,59,48,0.2)'
                  : '0 0 40px rgba(204,0,0,0.4), 0 0 80px rgba(204,0,0,0.15)',
              border: 'none',
              transition: 'background 0.3s ease, box-shadow 0.3s ease',
              cursor: isProcessing ? 'default' : 'pointer',
              opacity: isProcessing ? 0.9 : 1,
            }}
          >
            <span style={{ color: '#FFFFFF', fontSize: isProcessing ? 22 : 28, letterSpacing: '0.25em', fontWeight: 700 }}>
              {isProcessing ? 'PROCESSING' : isRecording ? 'STOP' : 'RECORD'}
            </span>
          </button>
        </div>

        {/* Bottom area — helper text / discard button */}
        <div className="flex flex-col items-center justify-start" style={{ height: 'calc(50% - 150px)', paddingTop: 24 }}>
          {isProcessing ? (
            <p style={{ color: '#C8D0CC', fontSize: 18, letterSpacing: '0.2em', fontWeight: 700, textAlign: 'center' }}>
              TRANSCRIBING & ASSESSING
            </p>
          ) : isRecording ? (
            <div className="flex flex-col items-center gap-4">
              <p style={{ color: '#FFFFFF', fontSize: 18, letterSpacing: '0.2em', fontWeight: 700 }}>
                TAP TO STOP
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); cleanupRecording(); setState('idle'); }}
                style={{
                  padding: '10px 28px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 16,
                  letterSpacing: '0.15em',
                  fontWeight: 600,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                DISCARD
              </button>
            </div>
          ) : (
            <>
              <p style={{ color: '#FFFFFF', fontSize: 18, letterSpacing: '0.2em', fontWeight: 700 }}>
                TAP TO START
              </p>
              {error && (
                <p className="mt-3" style={{ color: '#FF9500', fontSize: 18, letterSpacing: '0.2em' }}>{error}</p>
              )}
              {autoSend && sendCount > 0 && !error && (
                <p className="mt-3" style={{ color: 'hsl(var(--primary))', fontSize: 16, letterSpacing: '0.1em' }}>
                  {sendCount} transmission{sendCount !== 1 ? 's' : ''} sent
                </p>
              )}
            </>
          )}
        </div>

        <style>{`
          @keyframes pulse-ring {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.08); opacity: 0.4; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  // ─── STATE 4: READY (SEND) ───
  if (state === 'ready' && assessment) {
    const pc = PRIORITY_COLORS[assessment.priority] || 'hsl(var(--foreground))';

    return (
      <div className="flex flex-col items-center flex-1 px-6" style={{ position: 'relative' }}>
        {/* Top area */}
        <div className="flex flex-col items-center justify-end" style={{ height: 'calc(50% - 150px)', paddingBottom: 24 }}>
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.15em', color: pc }}>
            {assessment.priority} — {assessment.headline ? assessment.headline.slice(0, 60) : 'Ready'}
          </p>
        </div>

        {/* Green SEND button */}
        <div style={{ position: 'relative', width: 280, height: 280, flexShrink: 0 }}>
          <button
            onClick={handleConfirm}
            className="flex items-center justify-center rounded-full"
            style={{
              width: 280,
              height: 280,
              background: '#1B5E20',
              boxShadow: '0 0 60px rgba(52,199,89,0.4), 0 0 120px rgba(52,199,89,0.15)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span style={{ color: '#FFFFFF', fontSize: 32, letterSpacing: '0.3em', fontWeight: 700 }}>
              SEND
            </span>
          </button>
        </div>

        {/* Bottom — discard option */}
        <div className="flex flex-col items-center justify-start" style={{ height: 'calc(50% - 150px)', paddingTop: 24 }}>
          <button
            onClick={handleDiscard}
            style={{
              padding: '10px 28px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 16,
              letterSpacing: '0.15em',
              fontWeight: 600,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            DISCARD
          </button>
        </div>
      </div>
    );
  }

  // ─── STATE 5: CONFIRMED ───
  if (state === 'confirmed') {
    if (autoSend) {
      // Brief green flash — auto-returns to idle via setTimeout in autoSaveReport
      return (
        <div className="flex flex-col items-center justify-center flex-1 px-6">
          <div className="flex items-center justify-center rounded-full"
            style={{
              width: 280, height: 280,
              background: '#1B5E20',
              boxShadow: '0 0 80px rgba(52,199,89,0.5), 0 0 160px rgba(52,199,89,0.2)',
            }}>
            <span style={{ color: '#FFFFFF', fontSize: 28, letterSpacing: '0.25em', fontWeight: 700 }}>SENT</span>
          </div>
          <p className="mt-6" style={{ color: 'hsl(var(--primary))', fontSize: 16, letterSpacing: '0.1em' }}>
            {sendCount} transmission{sendCount !== 1 ? 's' : ''} this shift
          </p>
        </div>
      );
    }
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
