import { useCallback, useRef, useState } from 'react';
import { encodeWav, blobToBase64 } from '@/lib/audio-encoder';

interface UseAudioCaptureReturn {
  micStatus: 'pending' | 'granted' | 'denied';
  isCapturing: boolean;
  initMic: () => Promise<void>;
  startCapture: () => void;
  stopCapture: () => void;
  getAudioBase64: () => Promise<string | null>;
  rmsLevel: number;
}

export function useAudioCapture(
  onTrigger: () => void,
  onSilence: () => void
): UseAudioCaptureReturn {
  const [micStatus, setMicStatus] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [isCapturing, setIsCapturing] = useState(false);
  const [rmsLevel, setRmsLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const capturedRef = useRef<Float32Array[]>([]);
  const capturingRef = useRef(false);
  const consecutiveHighRef = useRef(0);
  const silenceStartRef = useRef<number | null>(null);
  const captureStartRef = useRef<number | null>(null);

  const initMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicStatus('granted');

      const ctx = new AudioContext({ sampleRate: 44100 });
      contextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        setRmsLevel(rms);

        if (capturingRef.current) {
          capturedRef.current.push(new Float32Array(data));
          
          // Max 30s
          if (captureStartRef.current && Date.now() - captureStartRef.current > 30000) {
            capturingRef.current = false;
            setIsCapturing(false);
            onSilence();
            return;
          }

          if (rms < 0.005) {
            if (!silenceStartRef.current) silenceStartRef.current = Date.now();
            if (Date.now() - silenceStartRef.current > 1500) {
              capturingRef.current = false;
              setIsCapturing(false);
              onSilence();
            }
          } else {
            silenceStartRef.current = null;
          }
        } else {
          if (rms > 0.01) {
            consecutiveHighRef.current++;
            if (consecutiveHighRef.current >= 3) {
              capturingRef.current = true;
              capturedRef.current = [];
              captureStartRef.current = Date.now();
              silenceStartRef.current = null;
              setIsCapturing(true);
              onTrigger();
              consecutiveHighRef.current = 0;
            }
          } else {
            consecutiveHighRef.current = 0;
          }
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
    } catch {
      setMicStatus('denied');
    }
  }, [onTrigger, onSilence]);

  const startCapture = useCallback(() => {
    capturingRef.current = true;
    capturedRef.current = [];
    captureStartRef.current = Date.now();
    silenceStartRef.current = null;
    setIsCapturing(true);
  }, []);

  const stopCapture = useCallback(() => {
    if (capturingRef.current) {
      capturingRef.current = false;
      setIsCapturing(false);
      onSilence();
    }
  }, [onSilence]);

  const getAudioBase64 = useCallback(async () => {
    if (capturedRef.current.length === 0) return null;
    const total = capturedRef.current.reduce((a, b) => a + b.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of capturedRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    capturedRef.current = [];
    const wav = encodeWav(merged, 44100);
    return blobToBase64(wav);
  }, []);

  return { micStatus, isCapturing, initMic, startCapture, getAudioBase64, rmsLevel };
}
