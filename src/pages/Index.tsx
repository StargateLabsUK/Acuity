import { useState, useCallback, useEffect } from 'react';
import { TopBar } from '@/components/herald/TopBar';
import { BottomNav } from '@/components/herald/BottomNav';
import { LiveTab } from '@/components/herald/LiveTab';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { getReports } from '@/lib/herald-storage';
import type { HeraldReport, LiveState } from '@/lib/herald-types';

const Index = () => {
  const [activeTab, setActiveTab] = useState<'live' | 'reports'>('live');
  const [aiStatus, setAiStatus] = useState<'ok' | 'error'>('ok');
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const syncStatus = useHeraldSync();

  const onTrigger = useCallback(() => {
    setLiveState('triggered');
  }, []);

  const onSilence = useCallback(() => {
    setLiveState('processing');
  }, []);

  const { micStatus, initMic, getAudioBase64, startCapture, stopCapture, isCapturing } = useAudioCapture(onTrigger, onSilence);

  // Don't auto-init — require user gesture for mic access

  useEffect(() => {
    setReports(getReports());
  }, [activeTab]);

  const refreshReports = useCallback(() => {
    setReports(getReports());
  }, []);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--herald-bg)' }}
    >
      <TopBar micStatus={micStatus} aiStatus={aiStatus} syncStatus={syncStatus} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'live' ? (
          <LiveTab
            onTrigger={onTrigger}
            onSilence={onSilence}
            getAudioBase64={getAudioBase64}
            onAiStatus={setAiStatus}
            onReportSaved={refreshReports}
            externalState={liveState}
            setExternalState={setLiveState}
            micStatus={micStatus}
            initMic={initMic}
          />
        ) : (
          <ReportsTab reports={reports} />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
