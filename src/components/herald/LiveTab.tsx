import { useState, useCallback, useEffect, useRef } from 'react';
import type { Assessment, LiveState } from '@/lib/herald-types';
import { TEST_TRANSMISSIONS, PRIORITY_COLORS, SERVICE_EMOJIS } from '@/lib/herald-types';
import { transcribeAudio, assessTranscript } from '@/lib/herald-api';
import { saveReport } from '@/lib/herald-storage';
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
}

export function LiveTab({
  getAudioBase64,
  onAiStatus,
  onReportSaved,
  externalState,
  setExternalState,
  micStatus,
  initMic,
}: LiveTabProps) {
  const state = externalState || 'idle';
  const [transcript, setTranscript] = useState('');
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState('');

  const processTransmission = useCallback(
    async (text: string, isTest: boolean) => {
      setExternalState('triggered');
      setError('');
      setTranscript('');
      setAssessment(null);

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
    [getAudioBase64, onAiStatus, setExternalState]
  );

  const handleConfirm = useCallback(() => {
    if (!assessment) return;
    const report: HeraldReport = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      transcript,
      assessment,
      synced: false,
      confirmed_at: new Date().toISOString(),
      headline: assessment.headline,
      priority: assessment.priority,
      service: assessment.service,
    };
    saveReport(report);
    onReportSaved();
    setExternalState('confirmed');
  }, [assessment, transcript, onReportSaved, setExternalState]);

  const handleDiscard = useCallback(() => {
    setExternalState('idle');
    setAssessment(null);
    setTranscript('');
  }, [setExternalState]);

  // Listen for audio triggers from outside
  const processAudioRef = useRef(processTransmission);
  processAudioRef.current = processTransmission;

  if (state === 'idle') {
    const micReady = micStatus === 'granted';

    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 overflow-auto">
        {!micReady ? (
          <>
            {/* Tap to enable mic */}
            <button
              onClick={initMic}
              className="relative flex items-center justify-center"
              style={{ width: 160, height: 160, borderRadius: '50%', border: '1px solid #1E3028', background: 'transparent' }}
            >
              <div
                className="flex flex-col items-center justify-center"
                style={{
                  width: 90,
                  height: 90,
                  borderRadius: '50%',
                  border: micStatus === 'denied' ? '1px solid rgba(255,59,48,0.3)' : '1px solid rgba(61,255,140,0.15)',
                }}
              >
                <span style={{ fontSize: 28 }}>🎙️</span>
                <span style={{ fontSize: 9, color: micStatus === 'denied' ? '#FF3B30' : '#3DFF8C', letterSpacing: '0.2em', marginTop: 4 }}>
                  {micStatus === 'denied' ? 'DENIED' : 'TAP'}
                </span>
              </div>
            </button>
            <p style={{ fontSize: 10, color: micStatus === 'denied' ? '#FF3B30' : '#3DFF8C', marginTop: 16 }}>
              {micStatus === 'denied' ? 'MICROPHONE ACCESS DENIED' : 'TAP TO ENABLE MICROPHONE'}
            </p>
          </>
        ) : (
          <>
            {/* Outer circle */}
            <div
              className="relative flex items-center justify-center"
              style={{ width: 160, height: 160, borderRadius: '50%', border: '1px solid #1E3028' }}
            >
              {/* Inner circle */}
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
                <span style={{ fontSize: 9, color: '#3DFF8C', letterSpacing: '0.2em', marginTop: 4 }}>
                  LISTENING
                </span>
              </div>
            </div>
            <p style={{ fontSize: 10, color: '#1E3028', marginTop: 16 }}>HERALD IS LISTENING</p>
          </>
        )}

        {error && (
          <p style={{ fontSize: 11, color: '#FF9500', marginTop: 8 }}>{error}</p>
        )}

        <div className="w-full mt-8">
          <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>
            TEST TRANSMISSIONS
          </p>
          {TEST_TRANSMISSIONS.map((t, i) => (
            <button
              key={i}
              onClick={() => processTransmission(t.text, true)}
              className="w-full text-left p-3 mb-2"
              style={{
                border: '1px solid #0F1820',
                background: 'transparent',
                borderRadius: 2,
              }}
            >
              <span style={{ fontSize: 10, color: '#3A5048', fontWeight: 600 }}>
                {t.label}
              </span>
              <p
                style={{ fontSize: 10, color: '#1E3028', marginTop: 4, lineHeight: 1.4 }}
                className="line-clamp-2"
              >
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
          {/* Pulse ring */}
          <div
            className="absolute animate-pulse-ring"
            style={{
              width: 160,
              height: 160,
              borderRadius: '50%',
              border: '2px solid #FF3B30',
            }}
          />
          <div
            className="flex flex-col items-center justify-center"
            style={{
              width: 160,
              height: 160,
              borderRadius: '50%',
              border: '2px solid #FF3B30',
              background: 'radial-gradient(circle, rgba(255,59,48,0.12), transparent)',
            }}
          >
            <span style={{ fontSize: 28, filter: 'drop-shadow(0 0 8px #FF3B30)' }}>🎙️</span>
            <span
              className="animate-pulse"
              style={{ fontSize: 9, color: '#FF3B30', letterSpacing: '0.1em', fontWeight: 700, marginTop: 4 }}
            >
              CAPTURING
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center flex-1">
        <div
          className="animate-spin-herald"
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '2px solid #0F1820',
            borderTopColor: '#3DFF8C',
          }}
        />
        <p style={{ fontSize: 10, color: '#1E3028', letterSpacing: '0.2em', marginTop: 16 }}>
          RUNNING INTELLIGENCE ASSESSMENT
        </p>
        {transcript && (
          <p style={{ fontSize: 12, color: '#2A4038', fontStyle: 'italic', marginTop: 12, textAlign: 'center', padding: '0 24px' }}>
            {transcript}
          </p>
        )}
      </div>
    );
  }

  if (state === 'ready' && assessment) {
    const pc = PRIORITY_COLORS[assessment.priority] || '#3A5048';
    const emoji = SERVICE_EMOJIS[assessment.service] || '📻';

    return (
      <div className="flex flex-col flex-1 overflow-auto pb-20">
        {/* Priority banner */}
        <div
          className="flex items-center justify-between px-4 flex-shrink-0"
          style={{
            height: 80,
            background: `${pc}1F`,
            borderBottom: `2px solid ${pc}`,
          }}
        >
          <div>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 36 }}>{emoji}</span>
              <span className="font-heading" style={{ fontSize: 42, fontWeight: 800, color: pc }}>
                {assessment.priority}
              </span>
            </div>
            <span style={{ fontSize: 11, color: pc, opacity: 0.8 }}>{assessment.priority_label}</span>
          </div>
          <span style={{ fontSize: 11, color: '#1E3028', textTransform: 'uppercase' }}>
            {assessment.service}
          </span>
        </div>

        {/* Headline */}
        <div className="mx-4 mt-3 p-3.5" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
          <p style={{ fontSize: 14, color: '#8A9890' }}>{assessment.headline}</p>
        </div>

        {/* Two column grid */}
        <div className="grid grid-cols-2 gap-3 mx-4 mt-3">
          {/* Protocol fields */}
          <div className="p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
            <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>PROTOCOL FIELDS</p>
            {assessment.structured && Object.entries(assessment.structured).map(([k, v]) => (
              <div key={k} className="mb-2">
                <p style={{ fontSize: 11, color: '#1E3028', fontWeight: 700 }}>{k}</p>
                <p style={{ fontSize: 11, color: '#4A6058' }}>{v}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
            <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>IMMEDIATE ACTIONS</p>
            {assessment.actions?.map((a, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <span style={{ fontSize: 12, color: pc, fontWeight: 700 }}>{i + 1}.</span>
                <span style={{ fontSize: 12, color: '#6A8070' }}>{a}</span>
              </div>
            ))}
            {assessment.transmit_to && (
              <>
                <div style={{ borderTop: '1px solid #0F1820', margin: '8px 0' }} />
                <p style={{ fontSize: 10, color: '#1E3028' }}>TRANSMIT TO: {assessment.transmit_to}</p>
              </>
            )}
          </div>
        </div>

        {/* Formatted report */}
        <div className="mx-4 mt-3 p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
          <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>FORMATTED REPORT</p>
          <pre style={{ fontSize: 11, color: '#3A5048', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'IBM Plex Mono, monospace' }}>
            {assessment.formatted_report}
          </pre>
        </div>

        {/* Raw transcript */}
        <div className="mx-4 mt-3 p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
          <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>RAW TRANSMISSION</p>
          <p style={{ fontSize: 12, color: '#2A4038', fontStyle: 'italic' }}>"{transcript}"</p>
          {assessment.confidence && (
            <p style={{ fontSize: 10, color: '#1E3028', marginTop: 4 }}>
              Confidence: {Math.round(assessment.confidence * 100)}%
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="fixed bottom-14 left-0 right-0 flex gap-3 px-4 pb-2 pt-2" style={{ background: '#080B10' }}>
          <button
            onClick={handleDiscard}
            className="flex-1 font-heading"
            style={{
              padding: 16,
              background: 'transparent',
              border: '1px solid #0F1820',
              color: '#1E3028',
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 2,
            }}
          >
            DISCARD
          </button>
          <button
            onClick={handleConfirm}
            className="font-heading"
            style={{
              flex: 3,
              padding: 16,
              background: `${pc}1A`,
              border: `2px solid ${pc}`,
              color: pc,
              fontSize: 18,
              fontWeight: 700,
              borderRadius: 2,
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
      <div className="flex flex-col items-center justify-center flex-1">
        <button
          onClick={() => setExternalState('idle')}
          className="w-full mx-4 font-heading"
          style={{
            padding: 16,
            background: 'rgba(61,255,140,0.06)',
            border: '1px solid rgba(61,255,140,0.2)',
            color: '#3DFF8C',
            fontSize: 14,
            fontWeight: 700,
            borderRadius: 2,
            maxWidth: 320,
          }}
        >
          ✓ HERALDED — RETURN TO LISTEN
        </button>
      </div>
    );
  }

  return null;
}
