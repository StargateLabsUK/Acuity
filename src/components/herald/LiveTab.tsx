import { useState, useCallback, useEffect, useRef } from 'react';
import type { Assessment, LiveState } from '@/lib/herald-types';
import { TEST_TRANSMISSIONS, PRIORITY_COLORS, SERVICE_EMOJIS } from '@/lib/herald-types';
import { transcribeAudio, assessTranscript } from '@/lib/herald-api';
import { saveReport, updateReport } from '@/lib/herald-storage';
import type { HeraldReport } from '@/lib/herald-types';

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

  const processTransmission = useCallback(
    async (text: string, isTest: boolean) => {
      setExternalState('triggered');
      setError('');
      setTranscript('');
      setAssessment(null);
      setCurrentReportId(null);

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
    if (!assessment || !currentReportId) return;
    updateReport(currentReportId, { confirmed_at: new Date().toISOString() });
    onReportSaved();
    setExternalState('confirmed');
  }, [assessment, currentReportId, onReportSaved, setExternalState]);

  const handleDiscard = useCallback(() => {
    setExternalState('idle');
    setAssessment(null);
    setTranscript('');
    setCurrentReportId(null);
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

        {/* Headline */}
        <div className="mx-3 md:mx-4 mt-3 p-3 md:p-4 border border-border rounded bg-card">
          <p className="text-sm md:text-base text-foreground leading-relaxed">{assessment.headline}</p>
        </div>

        {/* Two column grid - stacks on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mx-3 md:mx-4 mt-3">
          {/* Protocol fields */}
          <div>
            <p className="text-xs md:text-sm font-bold tracking-[0.1em] mb-2" style={{ color: pc }}>PROTOCOL FIELDS</p>
            <div className="p-3 md:p-4 border border-border rounded bg-card">
              {assessment.structured && Object.entries(assessment.structured).map(([k, v]) => (
                <div key={k} className="mb-2">
                  <p className="text-sm md:text-base font-bold" style={{ color: pc }}>{k}</p>
                  <p className="text-sm md:text-base text-foreground">{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div>
            <p className="text-xs md:text-sm font-bold tracking-[0.1em] mb-2" style={{ color: pc }}>IMMEDIATE ACTIONS</p>
            <div className="p-3 md:p-4 border border-border rounded bg-card">
              {assessment.actions?.map((a, i) => (
                <div key={i} className="flex gap-2 mb-1.5">
                  <span className="text-sm md:text-base font-bold" style={{ color: pc }}>{i + 1}.</span>
                  <span className="text-sm md:text-base text-foreground">{a}</span>
                </div>
              ))}
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

        {/* Formatted report */}
        <div className="mx-3 md:mx-4 mt-3">
          <p className="text-xs md:text-sm font-bold text-foreground tracking-[0.1em] mb-2">FORMATTED REPORT</p>
          <div className="p-3 md:p-4 border border-border rounded bg-card">
            <div className="text-sm md:text-base text-foreground leading-7 whitespace-pre-wrap">
              {assessment.formatted_report}
            </div>
          </div>
        </div>

        {/* Raw transcript */}
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
