import { useState, useCallback, useEffect, useRef } from 'react';
import type { Assessment, LiveState } from '@/lib/herald-types';
import { TEST_TRANSMISSIONS, PRIORITY_COLORS, SERVICE_EMOJIS } from '@/lib/herald-types';
import { transcribeAudio, assessTranscript } from '@/lib/herald-api';
import { saveReport, updateReport } from '@/lib/herald-storage';
import { computeDiff } from '@/lib/herald-diff';
import type { HeraldReport } from '@/lib/herald-types';

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

interface LiveTabProps {
  onTrigger: () => void;
  onSilence: () => void;
  getAudioBase64: () => Promise<string | null>;
  onAiStatus: (s: 'ok' | 'error') => void;
  onReportSaved: () => void;
  externalState?: LiveState;
  setExternalState: (s: LiveState) => void;
  micStatus: 'pending' | 'granted' | 'denied';
  initMic: () => Promise<void>;
  startCapture: () => void;
  stopCapture: () => void;
  isCapturing: boolean;
}

export function LiveTab({
  getAudioBase64,
  onAiStatus,
  onReportSaved,
  externalState,
  setExternalState,
  micStatus,
  initMic,
  startCapture,
  stopCapture,
  isCapturing,
}: LiveTabProps) {
  const state = externalState || 'idle';
  const [transcript, setTranscript] = useState('');
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState('');
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);

  // Editable state
  const [editHeadline, setEditHeadline] = useState('');
  const [editStructured, setEditStructured] = useState<Record<string, string>>({});
  const [editActions, setEditActions] = useState<string[]>([]);
  const [editFormattedReport, setEditFormattedReport] = useState('');
  const [originalAssessment, setOriginalAssessment] = useState<Assessment | null>(null);
  const [hasEdits, setHasEdits] = useState(false);

  // Initialize editable state when assessment arrives
  useEffect(() => {
    if (assessment && state === 'ready') {
      setEditHeadline(assessment.headline || '');
      setEditStructured({ ...(assessment.structured || {}) });
      setEditActions([...(assessment.actions || [])]);
      setEditFormattedReport(assessment.formatted_report || '');
      setOriginalAssessment(JSON.parse(JSON.stringify(assessment)));
    }
  }, [assessment, state]);

  // Track if edits exist
  useEffect(() => {
    if (!originalAssessment || !assessment) return;
    const current = buildFinalAssessment();
    const diff = computeDiff(originalAssessment, current);
    setHasEdits(diff.has_edits);
  }, [editHeadline, editStructured, editActions, editFormattedReport, originalAssessment]);

  const buildFinalAssessment = useCallback((): Assessment => {
    return {
      ...assessment!,
      headline: editHeadline,
      structured: { ...editStructured },
      actions: [...editActions],
      formatted_report: editFormattedReport,
    };
  }, [assessment, editHeadline, editStructured, editActions, editFormattedReport]);

  const processTransmission = useCallback(
    async (text: string, isTest: boolean) => {
      setExternalState('triggered');
      setError('');
      setTranscript('');
      setAssessment(null);
      setCurrentReportId(null);
      setOriginalAssessment(null);
      setHasEdits(false);

      await new Promise((r) => setTimeout(r, 300));
      setExternalState('processing');

      try {
        let finalTranscript = text;
        if (!isTest) {
          await new Promise((r) => setTimeout(r, 400));
          const audio = await getAudioBase64();
          if (!audio) throw new Error('No audio');
          finalTranscript = await transcribeAudio(audio);
        }
        setTranscript(finalTranscript);

        const result = await assessTranscript(finalTranscript);
        setAssessment(result);
        onAiStatus('ok');

        const loc = await getLocation();
        const report: HeraldReport = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          transcript: finalTranscript,
          assessment: result,
          synced: false,
          confirmed_at: null as unknown as string,
          headline: result.headline,
          priority: result.priority,
          service: result.service,
          ...loc,
        };
        saveReport(report);
        setCurrentReportId(report.id);
        onReportSaved();

        await new Promise((r) => setTimeout(r, isTest ? 2000 : 500));
        setExternalState('ready');
      } catch {
        onAiStatus('error');
        setError('Intelligence assessment failed');
        setTimeout(() => {
          setError('');
          setExternalState('idle');
        }, 3000);
      }
    },
    [getAudioBase64, onAiStatus, setExternalState, onReportSaved]
  );

  const handleConfirm = useCallback(() => {
    if (!assessment || !currentReportId || !originalAssessment) return;
    const finalAssessment = buildFinalAssessment();
    const diff = computeDiff(originalAssessment, finalAssessment);

    updateReport(currentReportId, {
      confirmed_at: new Date().toISOString(),
      assessment: finalAssessment as unknown as Assessment,
      headline: finalAssessment.headline,
      priority: finalAssessment.priority,
      service: finalAssessment.service,
    });

    // Store extra fields in localStorage for sync
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
          localStorage.setItem('herald_reports', JSON.stringify(reports));
        }
      }
    } catch { /* silent */ }

    onReportSaved();
    setExternalState('confirmed');
  }, [assessment, currentReportId, onReportSaved, setExternalState, originalAssessment, buildFinalAssessment]);

  const handleDiscard = useCallback(() => {
    setExternalState('idle');
    setAssessment(null);
    setTranscript('');
    setCurrentReportId(null);
    setOriginalAssessment(null);
    setHasEdits(false);
  }, [setExternalState]);

  const processAudioRef = useRef(processTransmission);
  processAudioRef.current = processTransmission;

  const hasStartedProcessing = useRef(false);
  useEffect(() => {
    if (state === 'processing' && !hasStartedProcessing.current) {
      hasStartedProcessing.current = true;
      (async () => {
        try {
          const audio = await getAudioBase64();
          if (!audio) throw new Error('No audio captured');
          setTranscript('');
          const t = await transcribeAudio(audio);
          setTranscript(t);
          const result = await assessTranscript(t);
          setAssessment(result);
          onAiStatus('ok');

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
            ...(await getLocation()),
          };
          saveReport(report);
          setCurrentReportId(report.id);
          onReportSaved();

          setExternalState('ready');
        } catch {
          onAiStatus('error');
          setError('Intelligence assessment failed');
          setTimeout(() => {
            setError('');
            setExternalState('idle');
          }, 3000);
        } finally {
          hasStartedProcessing.current = false;
        }
      })();
    }
    if (state !== 'processing') {
      hasStartedProcessing.current = false;
    }
  }, [state, getAudioBase64, onAiStatus, setExternalState, onReportSaved]);

  // Auto-resize textarea ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [editFormattedReport]);

  if (state === 'idle') {
    const micReady = micStatus === 'granted';

    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 overflow-auto">
        {!micReady ? (
          <>
            <button
              onClick={initMic}
              className="relative flex items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-full border border-foreground bg-transparent"
            >
              <div
                className="flex flex-col items-center justify-center w-20 h-20 md:w-[90px] md:h-[90px] rounded-full"
                style={{
                  border: micStatus === 'denied' ? '1px solid rgba(255,59,48,0.3)' : '1px solid rgba(61,255,140,0.15)',
                }}
              >
                <span className="text-2xl md:text-3xl">🎙️</span>
                <span className="text-sm md:text-base tracking-[0.2em] mt-1" style={{ color: micStatus === 'denied' ? '#FF3B30' : 'hsl(var(--primary))' }}>
                  {micStatus === 'denied' ? 'DENIED' : 'TAP'}
                </span>
              </div>
            </button>
            <p className="text-sm md:text-base mt-4" style={{ color: micStatus === 'denied' ? '#FF3B30' : 'hsl(var(--primary))' }}>
              {micStatus === 'denied' ? 'MICROPHONE ACCESS DENIED' : 'TAP TO ENABLE MICROPHONE'}
            </p>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                if (isCapturing) {
                  stopCapture();
                } else {
                  startCapture();
                }
              }}
              className="relative flex items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-full bg-transparent"
              style={{ border: `2px solid ${isCapturing ? '#FF3B30' : 'hsl(var(--foreground))'}` }}
            >
              <div
                className={`flex flex-col items-center justify-center w-20 h-20 md:w-[90px] md:h-[90px] rounded-full ${isCapturing ? 'animate-pulse' : 'animate-breathe'}`}
                style={{
                  border: `1px solid ${isCapturing ? 'rgba(255,59,48,0.4)' : 'rgba(61,255,140,0.15)'}`,
                  background: isCapturing ? 'radial-gradient(circle, rgba(255,59,48,0.1), transparent)' : 'transparent',
                }}
              >
                <span className="text-2xl md:text-3xl">{isCapturing ? '⏹️' : '🎙️'}</span>
                <span className="text-sm md:text-base tracking-[0.2em] mt-1 font-bold" style={{ color: isCapturing ? '#FF3B30' : 'hsl(var(--primary))' }}>
                  {isCapturing ? 'STOP' : 'RECORD'}
                </span>
              </div>
            </button>
            <p className="text-sm md:text-base mt-4" style={{ color: isCapturing ? '#FF3B30' : 'hsl(var(--foreground))' }}>
              {isCapturing ? 'TAP TO STOP RECORDING' : 'TAP TO START RECORDING'}
            </p>
          </>
        )}

        {error && (
          <p className="text-sm md:text-base mt-2" style={{ color: '#FF9500' }}>{error}</p>
        )}

        <div className="w-full max-w-lg mt-6 md:mt-8">
          <p className="text-sm md:text-base text-foreground tracking-[0.1em] mb-2">
            TEST TRANSMISSIONS
          </p>
          {TEST_TRANSMISSIONS.map((t, i) => (
            <button
              key={i}
              onClick={() => processTransmission(t.text, true)}
              className="w-full text-left p-3 mb-2 border border-border bg-transparent rounded-sm"
            >
              <span className="text-sm md:text-base text-foreground font-semibold">
                {t.label}
              </span>
              <p className="text-xs md:text-sm text-foreground mt-1 leading-relaxed line-clamp-2">
                {t.text}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (state === 'triggered') {
    return (
      <div className="flex flex-col items-center justify-center flex-1">
        <div className="relative flex items-center justify-center">
          <div
            className="absolute animate-pulse-ring w-32 h-32 md:w-40 md:h-40 rounded-full"
            style={{ border: '2px solid #FF3B30' }}
          />
          <div
            className="flex flex-col items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-full"
            style={{
              border: '2px solid #FF3B30',
              background: 'radial-gradient(circle, rgba(255,59,48,0.12), transparent)',
            }}
          >
            <span className="text-2xl md:text-3xl" style={{ filter: 'drop-shadow(0 0 8px #FF3B30)' }}>🎙️</span>
            <span className="animate-pulse text-sm md:text-base tracking-[0.1em] font-bold mt-1" style={{ color: '#FF3B30' }}>
              CAPTURING
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4">
        <div
          className="animate-spin-herald w-10 h-10 md:w-12 md:h-12 rounded-full"
          style={{
            border: '2px solid hsl(var(--border))',
            borderTopColor: 'hsl(var(--primary))',
          }}
        />
        <p className="text-sm md:text-base text-foreground tracking-[0.2em] mt-4 text-center">
          RUNNING INTELLIGENCE ASSESSMENT
        </p>
        <p className="text-xs md:text-sm text-foreground mt-2 opacity-50 text-center">
          THIS MAY TAKE 15-30 SECONDS
        </p>
        {transcript && (
          <p className="text-sm md:text-base text-foreground italic mt-3 text-center px-4">
            "{transcript}"
          </p>
        )}
      </div>
    );
  }

  if (state === 'ready' && assessment) {
    const pc = PRIORITY_COLORS[assessment.priority] || 'hsl(var(--foreground))';
    const emoji = SERVICE_EMOJIS[assessment.service] || '📻';

    return (
      <div className="flex flex-col flex-1 overflow-auto pb-20">
        {/* Priority banner */}
        <div
          className="flex items-center justify-between px-3 md:px-4 flex-shrink-0 py-3 md:py-4"
          style={{
            background: `${pc}1F`,
            borderBottom: `2px solid ${pc}`,
          }}
        >
          <div>
            <div className="flex items-baseline gap-2 md:gap-3">
              <span className="text-2xl md:text-4xl">{emoji}</span>
              <span className="font-heading text-3xl md:text-5xl" style={{ color: pc }}>
                {assessment.priority}
              </span>
              <span className="font-heading text-lg md:text-[28px]" style={{ color: pc }}>
                {assessment.priority_label}
              </span>
            </div>
          </div>
          <span className="text-sm md:text-base text-foreground uppercase font-bold">
            {assessment.service}
          </span>
        </div>

        {/* Edited indicator */}
        {hasEdits && (
          <div className="mx-3 md:mx-4 mt-2 flex items-center gap-1">
            <span style={{ fontSize: '9px', color: '#FF9500', letterSpacing: '0.2em', fontWeight: 700 }}>
              ✏️ EDITED
            </span>
          </div>
        )}

        {/* Headline — editable */}
        <div className="mx-3 md:mx-4 mt-3 border border-border rounded bg-card">
          <textarea
            value={editHeadline}
            onChange={(e) => setEditHeadline(e.target.value)}
            placeholder="Tap to edit"
            className="w-full bg-transparent text-sm md:text-base text-foreground leading-relaxed p-3 md:p-4 resize-none outline-none"
            style={{
              minHeight: '48px',
            }}
            onFocus={(e) => {
              (e.target as HTMLTextAreaElement).style.background = 'rgba(61,255,140,0.04)';
              (e.target as HTMLTextAreaElement).style.borderColor = 'rgba(61,255,140,0.2)';
            }}
            onBlur={(e) => {
              (e.target as HTMLTextAreaElement).style.background = 'transparent';
              (e.target as HTMLTextAreaElement).style.borderColor = '';
            }}
            rows={2}
          />
        </div>

        {/* Two column grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mx-3 md:mx-4 mt-3">
          {/* Protocol fields — editable values */}
          <div>
            <p className="text-xs md:text-sm font-bold tracking-[0.1em] mb-2" style={{ color: pc }}>PROTOCOL FIELDS</p>
            <div className="p-3 md:p-4 border border-border rounded bg-card">
              {Object.entries(editStructured).map(([k, v]) => (
                <div key={k} className="mb-2">
                  <p className="text-sm md:text-base font-bold" style={{ color: pc }}>{k}</p>
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => setEditStructured((prev) => ({ ...prev, [k]: e.target.value }))}
                    className="w-full bg-transparent text-sm md:text-base text-foreground outline-none py-0.5"
                    style={{ borderBottom: '1px solid transparent' }}
                    placeholder="Tap to edit"
                    onFocus={(e) => {
                      (e.target as HTMLInputElement).style.borderBottom = '1px solid rgba(61,255,140,0.3)';
                    }}
                    onBlur={(e) => {
                      (e.target as HTMLInputElement).style.borderBottom = '1px solid transparent';
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Actions — editable with add/remove */}
          <div>
            <p className="text-xs md:text-sm font-bold tracking-[0.1em] mb-2" style={{ color: pc }}>IMMEDIATE ACTIONS</p>
            <div className="p-3 md:p-4 border border-border rounded bg-card">
              {editActions.map((a, i) => (
                <div key={i} className="flex gap-2 mb-1.5 items-start">
                  <span className="text-sm md:text-base font-bold flex-shrink-0 mt-0.5" style={{ color: pc }}>{i + 1}.</span>
                  <input
                    type="text"
                    value={a}
                    onChange={(e) => {
                      const next = [...editActions];
                      next[i] = e.target.value;
                      setEditActions(next);
                    }}
                    className="flex-1 bg-transparent text-sm md:text-base text-foreground outline-none"
                    style={{ borderBottom: '1px solid transparent' }}
                    onFocus={(e) => {
                      (e.target as HTMLInputElement).style.borderBottom = '1px solid rgba(61,255,140,0.3)';
                    }}
                    onBlur={(e) => {
                      (e.target as HTMLInputElement).style.borderBottom = '1px solid transparent';
                    }}
                  />
                  <button
                    onClick={() => setEditActions(editActions.filter((_, idx) => idx !== i))}
                    className="text-xs opacity-50 hover:opacity-100 flex-shrink-0 mt-0.5"
                    style={{ color: '#FF3B30' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditActions([...editActions, ''])}
                className="text-xs mt-2 px-2 py-1 rounded-sm"
                style={{ color: 'hsl(var(--primary))', border: '1px solid rgba(61,255,140,0.2)' }}
              >
                + ADD ACTION
              </button>
              {assessment.transmit_to && (
                <>
                  <div className="border-t border-border my-2" />
                  <p className="text-sm md:text-base text-foreground">
                    <span className="font-bold" style={{ color: pc }}>TRANSMIT TO:</span> {assessment.transmit_to}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Formatted report — editable */}
        <div className="mx-3 md:mx-4 mt-3">
          <p className="text-xs md:text-sm font-bold text-foreground tracking-[0.1em] mb-2">FORMATTED REPORT</p>
          <div className="border border-border rounded bg-card">
            <textarea
              ref={textareaRef}
              value={editFormattedReport}
              onChange={(e) => setEditFormattedReport(e.target.value)}
              className="w-full bg-transparent text-sm md:text-base text-foreground leading-7 whitespace-pre-wrap p-3 md:p-4 resize-none outline-none"
              style={{ minHeight: '100px' }}
              onFocus={(e) => {
                (e.target as HTMLTextAreaElement).style.background = 'rgba(61,255,140,0.04)';
              }}
              onBlur={(e) => {
                (e.target as HTMLTextAreaElement).style.background = 'transparent';
              }}
            />
          </div>
        </div>

        {/* Raw transcript — NOT editable */}
        <div className="mx-3 md:mx-4 mt-3">
          <p className="text-xs md:text-sm font-bold text-foreground tracking-[0.1em] mb-2">RAW TRANSMISSION</p>
          <div className="p-3 md:p-4 border border-border rounded bg-card">
            <p className="text-sm md:text-base text-foreground italic">"{transcript}"</p>
            {assessment.confidence && (
              <p className="text-sm md:text-base text-foreground mt-2 opacity-70">
                Confidence: {Math.round(assessment.confidence * 100)}%
              </p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="fixed bottom-12 md:bottom-14 left-0 right-0 flex gap-3 px-3 md:px-4 pb-2 pt-2 bg-background">
          <button
            onClick={handleDiscard}
            className="flex-1 font-heading py-3 md:py-4 bg-transparent border border-border text-foreground text-sm md:text-base font-bold rounded-sm"
          >
            DISCARD
          </button>
          <button
            onClick={handleConfirm}
            className="font-heading py-3 md:py-4 text-base md:text-lg font-bold rounded-sm"
            style={{
              flex: 3,
              background: `${pc}1A`,
              border: `2px solid ${pc}`,
              color: pc,
              boxShadow: `0 0 24px ${pc}33`,
            }}
          >
            ✦ HERALD
          </button>
        </div>
      </div>
    );
  }

  if (state === 'confirmed') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4">
        <button
          onClick={() => setExternalState('idle')}
          className="w-full max-w-xs font-heading py-3 md:py-4 text-sm md:text-base font-bold rounded-sm"
          style={{
            background: 'rgba(61,255,140,0.06)',
            border: '1px solid rgba(61,255,140,0.2)',
            color: 'hsl(var(--primary))',
          }}
        >
          ✓ HERALDED — RETURN TO LISTEN
        </button>
      </div>
    );
  }

  return null;
}
