import { useState, useCallback, useEffect, useRef } from 'react';
import type { Assessment, LiveState } from '@/lib/herald-types';
import { TEST_TRANSMISSIONS, PRIORITY_COLORS, SERVICE_LABELS } from '@/lib/herald-types';
import { transcribeAudio, assessTranscript } from '@/lib/herald-api';
import { saveReport, updateReport } from '@/lib/herald-storage';
import { computeDiff } from '@/lib/herald-diff';
import { getSession } from '@/lib/herald-session';
import type { HeraldReport } from '@/lib/herald-types';

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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef('');
  const recordingStartRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (assessment && state === 'ready') {
      setEditHeadline(assessment.headline || '');
      setEditStructured({ ...(assessment.structured || {}) });
      setEditActions([...(assessment.actions || [])]);
      setEditFormattedReport(assessment.formatted_report || '');
      setOriginalAssessment(JSON.parse(JSON.stringify(assessment)));
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
          setTranscript(t);

          const result = await assessTranscript(t);
          setAssessment(result);
          onAiStatus('ok');

          const loc = await getLocation();
          const sessionFields = getSessionFields();
          const report: HeraldReport = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            transcript: t,
            assessment: result,
            synced: false,
            confirmed_at: null as unknown as string,
            headline: result.headline,
            priority: result.priority,
            service: result.service,
            ...loc,
            ...sessionFields,
          };
          saveReport(report);
          setCurrentReportId(report.id);
          onReportSaved();
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
  }, [cleanupRecording, onAiStatus, onReportSaved]);

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
      setTranscript(text);
      const result = await assessTranscript(text);
      setAssessment(result);
      onAiStatus('ok');

      const loc = await getLocation();
      const sessionFields = getSessionFields();
      const report: HeraldReport = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        transcript: text,
        assessment: result,
        synced: false,
        confirmed_at: null as unknown as string,
        headline: result.headline,
        priority: result.priority,
        service: result.service,
        ...loc,
        ...sessionFields,
      };
      saveReport(report);
      setCurrentReportId(report.id);
      onReportSaved();
      setState('ready');
    } catch {
      onAiStatus('error');
      setError('Intelligence assessment failed');
      setTimeout(() => {
        setError('');
        setState('idle');
      }, 3000);
    }
  }, [onAiStatus, onReportSaved]);

  const handleConfirm = useCallback(async () => {
    if (!assessment || !currentReportId || !originalAssessment) return;
    const finalAssessment = buildFinalAssessment();
    const diff = computeDiff(originalAssessment, finalAssessment);

    const loc = await getLocation();
    const sessionFields = getSessionFields();

    updateReport(currentReportId, {
      confirmed_at: new Date().toISOString(),
      assessment: finalAssessment as unknown as Assessment,
      headline: finalAssessment.headline,
      priority: finalAssessment.priority,
      service: finalAssessment.service,
      ...loc,
      ...sessionFields,
    });

    try {
      const raw = localStorage.getItem('herald_reports');
      if (raw) {
        const reports = JSON.parse(raw);
        const idx = reports.findIndex((r: any) => r.id === currentReportId);
        if (idx !== -1) {
          reports[idx].original_assessment = originalAssessment;
          reports[idx].final_assessment = finalAssessment;
          reports[idx].diff = diff;
          reports[idx].edited = diff.has_edits;
          if (loc.lat) reports[idx].lat = loc.lat;
          if (loc.lng) reports[idx].lng = loc.lng;
          if (loc.location_accuracy) reports[idx].location_accuracy = loc.location_accuracy;
          // Ensure session fields are on the report
          Object.assign(reports[idx], sessionFields);
          localStorage.setItem('herald_reports', JSON.stringify(reports));
        }
      }
    } catch { /* silent */ }

    onReportSaved();
    setState('confirmed');
  }, [assessment, currentReportId, onReportSaved, originalAssessment, buildFinalAssessment]);

  const handleDiscard = useCallback(() => {
    setState('idle');
    setAssessment(null);
    setTranscript('');
    setCurrentReportId(null);
    setOriginalAssessment(null);
    setHasEdits(false);
  }, []);

  // ─── STATE 1: IDLE ───
  if (state === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 overflow-auto">
        <button
          onClick={startRecording}
          className="relative flex items-center justify-center bg-transparent"
          style={{ width: 160, height: 160, borderRadius: '50%', border: '1px solid #1E3028' }}
        >
          <div
            className="flex flex-col items-center justify-center animate-breathe"
            style={{
              width: 90,
              height: 90,
              borderRadius: '50%',
              border: '1px solid rgba(61,255,140,0.15)',
            }}
          >
            <span style={{ fontSize: 28 }}>🎙️</span>
            <span style={{ color: '#3DFF8C', fontSize: 18, letterSpacing: '0.2em', marginTop: 4, fontWeight: 700 }}>
              READY
            </span>
          </div>
        </button>

        <p style={{ color: '#1E3028', fontSize: 18, letterSpacing: '0.2em', marginTop: 16, textAlign: 'center' }}>
          TAP TO START RECORDING
        </p>

        {error && (
          <p className="mt-2" style={{ color: '#FF9500', fontSize: 18, letterSpacing: '0.2em' }}>{error}</p>
        )}

        <div className="w-full max-w-lg mt-6 md:mt-8">
          <p style={{ color: '#1E3028', fontSize: 18, letterSpacing: '0.25em', marginBottom: 8 }}>
            TEST TRANSMISSIONS
          </p>
          {TEST_TRANSMISSIONS.map((t, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                processTestTransmission(t.text);
              }}
              className="w-full text-left p-3 mb-2 border border-border bg-transparent rounded-sm"
            >
              <span className="text-lg md:text-lg text-foreground font-semibold">
                {t.emoji} {t.label}
              </span>
              <p className="text-lg md:text-lg text-foreground mt-1 leading-relaxed line-clamp-2">
                {t.text}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── STATE 2: RECORDING ───
  if (state === 'recording') {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 px-4 cursor-pointer"
        onClick={stopRecordingAndProcess}
      >
        <div
          className="fixed top-0 left-0 right-0 z-50 overflow-hidden"
          style={{ height: 2, background: 'rgba(255,59,48,0.2)' }}
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

        {maxReached && (
          <p className="mb-4" style={{ color: '#FF9500', fontSize: 18, letterSpacing: '0.2em', fontWeight: 700 }}>
            MAX DURATION REACHED
          </p>
        )}

        <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
          <div
            className="absolute inset-0 rounded-full animate-pulse-ring"
            style={{ border: '2px solid #FF3B30' }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: '2px solid #FF3B30',
              boxShadow: '0 0 40px rgba(255,59,48,0.2)',
            }}
          />
          <div
            className="flex flex-col items-center justify-center"
            style={{
              width: 90,
              height: 90,
              borderRadius: '50%',
              border: '2px solid #FF3B30',
              background: 'radial-gradient(circle, rgba(255,59,48,0.12), transparent)',
            }}
          >
            <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 8px #FF3B30)' }}>🎙️</span>
            <span style={{ color: '#FF3B30', fontSize: 18, fontWeight: 700, letterSpacing: '0.2em', marginTop: 2 }}>
              RECORDING
            </span>
          </div>
        </div>

        <p
          style={{
            color: '#FF3B30',
            fontSize: 18,
            fontVariantNumeric: 'tabular-nums',
            marginTop: 16,
          }}
        >
          {formatDuration(recordingDuration)}
        </p>

        <p style={{ color: '#FF3B30', fontSize: 18, letterSpacing: '0.2em', marginTop: 8 }}>
          TAP TO STOP AND PROCESS
        </p>
      </div>
    );
  }

  // ─── STATE 3: PROCESSING ───
  if (state === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4">
        <div
          className="animate-spin-herald rounded-full"
          style={{
            width: 48,
            height: 48,
            border: '2px solid #0F1820',
            borderTopColor: '#3DFF8C',
          }}
        />
        <p style={{ color: '#1E3028', fontSize: 18, letterSpacing: '0.2em', marginTop: 16, textAlign: 'center' }}>
          RUNNING INTELLIGENCE ASSESSMENT
        </p>
        {capturedDuration > 0 && (
          <p style={{ color: '#1E3028', fontSize: 18, marginTop: 8 }}>
            CAPTURED: {formatDuration(capturedDuration)}
          </p>
        )}
        {transcript && (
          <div
            className="mt-4 mx-4 max-w-md"
            style={{
              border: '1px solid #0F1820',
              padding: 12,
              borderRadius: 4,
            }}
          >
            <p className="line-clamp-3 text-center" style={{ color: '#2A4038', fontSize: 18, fontStyle: 'italic' }}>
              "{transcript}"
            </p>
          </div>
        )}
        {error && (
          <p className="mt-2" style={{ color: '#FF9500', fontSize: 18 }}>{error}</p>
        )}
      </div>
    );
  }

  // ─── STATE 4: READY ───
  if (state === 'ready' && assessment) {
    const pc = PRIORITY_COLORS[assessment.priority] || 'hsl(var(--foreground))';
    const serviceLabel = SERVICE_LABELS[assessment.service] || assessment.service.toUpperCase();

    return (
      <div className="flex flex-col flex-1 overflow-auto pb-20">
        <div
          className="flex items-center justify-between px-3 md:px-4 flex-shrink-0 py-3 md:py-4"
          style={{ background: `${pc}1F`, borderBottom: `2px solid ${pc}` }}
        >
          <div className="flex items-baseline gap-2 md:gap-3">
            <span className="text-2xl md:text-4xl">{emoji}</span>
            <span className="font-heading text-3xl md:text-5xl" style={{ color: pc }}>{assessment.priority}</span>
            <span className="font-heading text-lg md:text-[28px]" style={{ color: pc }}>{assessment.priority_label}</span>
          </div>
          <span className="text-lg md:text-lg text-foreground uppercase font-bold">{assessment.service}</span>
        </div>

        {hasEdits && (
          <div className="mx-3 md:mx-4 mt-2 flex items-center gap-1">
            <span style={{ fontSize: 18, color: '#FF9500', letterSpacing: '0.2em', fontWeight: 700 }}>✏️ EDITED</span>
          </div>
        )}

        <div className="mx-3 md:mx-4 mt-3 border border-border rounded bg-card">
          <textarea
            value={editHeadline}
            onChange={(e) => setEditHeadline(e.target.value)}
            placeholder="Tap to edit"
            className="w-full bg-transparent text-lg md:text-lg text-foreground leading-relaxed p-3 md:p-4 resize-none outline-none"
            style={{ minHeight: 48 }}
            onFocus={(e) => { e.currentTarget.style.background = 'rgba(61,255,140,0.04)'; }}
            onBlur={(e) => { e.currentTarget.style.background = 'transparent'; }}
            rows={2}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mx-3 md:mx-4 mt-3">
          <div>
            <p className="text-lg md:text-lg font-bold tracking-[0.1em] mb-2" style={{ color: pc }}>PROTOCOL FIELDS</p>
            <div className="p-3 md:p-4 border border-border rounded bg-card">
              {Object.entries(editStructured).map(([k, v]) => (
                <div key={k} className="mb-2">
                  <p className="text-lg md:text-lg font-bold" style={{ color: pc }}>{k}</p>
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => setEditStructured((prev) => ({ ...prev, [k]: e.target.value }))}
                    className="w-full bg-transparent text-lg md:text-lg text-foreground outline-none py-0.5"
                    style={{ borderBottom: '1px solid transparent' }}
                    placeholder="Tap to edit"
                    onFocus={(e) => { e.currentTarget.style.borderBottom = '1px solid rgba(61,255,140,0.3)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderBottom = '1px solid transparent'; }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-lg md:text-lg font-bold tracking-[0.1em] mb-2" style={{ color: pc }}>IMMEDIATE ACTIONS</p>
            <div className="p-3 md:p-4 border border-border rounded bg-card">
              {editActions.map((a, i) => (
                <div key={i} className="flex gap-2 mb-1.5 items-start">
                  <span className="text-lg md:text-lg font-bold flex-shrink-0 mt-0.5" style={{ color: pc }}>{i + 1}.</span>
                  <input
                    type="text"
                    value={a}
                    onChange={(e) => {
                      const next = [...editActions];
                      next[i] = e.target.value;
                      setEditActions(next);
                    }}
                    className="flex-1 bg-transparent text-lg md:text-lg text-foreground outline-none"
                    style={{ borderBottom: '1px solid transparent' }}
                    onFocus={(e) => { e.currentTarget.style.borderBottom = '1px solid rgba(61,255,140,0.3)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderBottom = '1px solid transparent'; }}
                  />
                  <button
                    onClick={() => setEditActions(editActions.filter((_, idx) => idx !== i))}
                    className="text-lg opacity-50 hover:opacity-100 flex-shrink-0 mt-0.5"
                    style={{ color: '#FF3B30' }}
                  >✕</button>
                </div>
              ))}
              <button
                onClick={() => setEditActions([...editActions, ''])}
                className="text-lg mt-2 px-2 py-1 rounded-sm"
                style={{ color: 'hsl(var(--primary))', border: '1px solid rgba(61,255,140,0.2)' }}
              >+ ADD ACTION</button>
              {assessment.transmit_to && (
                <>
                  <div className="border-t border-border my-2" />
                  <p className="text-lg md:text-lg text-foreground">
                    <span className="font-bold" style={{ color: pc }}>TRANSMIT TO:</span> {assessment.transmit_to}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mx-3 md:mx-4 mt-3">
          <p className="text-lg md:text-lg font-bold text-foreground tracking-[0.1em] mb-2">FORMATTED REPORT</p>
          <div className="border border-border rounded bg-card">
            <textarea
              ref={textareaRef}
              value={editFormattedReport}
              onChange={(e) => setEditFormattedReport(e.target.value)}
              className="w-full bg-transparent text-lg md:text-lg text-foreground leading-7 whitespace-pre-wrap p-3 md:p-4 resize-none outline-none"
              style={{ minHeight: 100 }}
              onFocus={(e) => { e.currentTarget.style.background = 'rgba(61,255,140,0.04)'; }}
              onBlur={(e) => { e.currentTarget.style.background = 'transparent'; }}
            />
          </div>
        </div>

        <div className="mx-3 md:mx-4 mt-3">
          <p className="text-lg md:text-lg font-bold text-foreground tracking-[0.1em] mb-2">RAW TRANSMISSION</p>
          <div className="p-3 md:p-4 border border-border rounded bg-card">
            <p className="text-lg md:text-lg text-foreground italic">"{transcript}"</p>
            {assessment.confidence != null && (
              <p className="text-lg md:text-lg text-foreground mt-2 opacity-70">
                Confidence: {Math.round(assessment.confidence * 100)}%
              </p>
            )}
          </div>
        </div>

        <div className="fixed bottom-12 md:bottom-14 left-0 right-0 flex gap-3 px-3 md:px-4 pb-2 pt-2 bg-background">
          <button
            onClick={handleDiscard}
            className="flex-1 font-heading py-3 md:py-4 bg-transparent border border-border text-foreground text-lg md:text-lg font-bold rounded-sm"
          >DISCARD</button>
          <button
            onClick={handleConfirm}
            className="font-heading py-3 md:py-4 text-lg md:text-lg font-bold rounded-sm"
            style={{
              flex: 3,
              background: `${pc}1A`,
              border: `2px solid ${pc}`,
              color: pc,
              boxShadow: `0 0 24px ${pc}33`,
            }}
          >✦ HERALD</button>
        </div>
      </div>
    );
  }

  // ─── STATE 5: CONFIRMED ───
  if (state === 'confirmed') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4">
        <button
          onClick={() => setState('idle')}
          className="w-full max-w-xs font-heading py-3 md:py-4 text-lg md:text-lg font-bold rounded-sm"
          style={{
            background: 'rgba(61,255,140,0.06)',
            border: '1px solid rgba(61,255,140,0.2)',
            color: 'hsl(var(--primary))',
          }}
        >✓ HERALDED — RETURN TO LISTEN</button>
      </div>
    );
  }

  return null;
}
