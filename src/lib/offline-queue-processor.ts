/**
 * Offline Queue Processor — drains the queue by executing each item's
 * network operation. Called by useHeraldSync on interval/reconnect.
 */

import { getReady, remove, markFailed, purgeExpired, count, type QueueItem } from './offline-queue';
import { transcribeAudio, assessTranscript, syncReport, syncDisposition } from './herald-api';
import { saveReport, markSynced } from './herald-storage';
import { toSyncPayload } from './herald-sync';
import { getSession } from './herald-session';
import { initiateTransfer, acceptTransfer, declineTransfer } from './transfer-types';
import type { HeraldReport } from './herald-types';
import type { Assessment } from './herald-types';

/** Process all ready queue items. Returns { processed, failed, remaining }. */
export async function processQueue(): Promise<{ processed: number; failed: number; remaining: number }> {
  if (!navigator.onLine) {
    return { processed: 0, failed: 0, remaining: await count() };
  }

  // Clean up items that have exceeded max retries
  await purgeExpired();

  const items = await getReady();
  let processed = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await processItem(item);
      if (item.id != null) await remove(item.id);
      processed++;
    } catch (err: any) {
      const errMsg = err?.message ?? 'Unknown error';
      if (item.id != null) await markFailed(item.id, errMsg);
      failed++;
    }
  }

  const remaining = await count();
  return { processed, failed, remaining };
}

async function processItem(item: QueueItem): Promise<void> {
  switch (item.type) {
    case 'transcribe':
      await processTranscribe(item);
      break;
    case 'sync-report':
      await processSyncReport(item);
      break;
    case 'sync-disposition':
      await processSyncDisposition(item);
      break;
    case 'transfer':
      await processTransfer(item);
      break;
    default:
      throw new Error(`Unknown queue item type: ${item.type}`);
  }
}

/**
 * Transcribe queued audio → assess → save report → sync.
 * This replays the full LiveTab recording pipeline.
 */
async function processTranscribe(item: QueueItem): Promise<void> {
  const { audio_base64, mime_type, report_id, session_data, vehicle_type, can_transport, existing_atmist } = item.payload;

  // Step 1: Transcribe
  const transcript = await transcribeAudio(
    audio_base64 as string,
    (mime_type as string) || 'audio/webm',
  );

  if (!transcript || !transcript.trim()) {
    throw new Error('Transcription returned empty');
  }

  // Step 2: Assess (fallback to minimal assessment if AI is temporarily unavailable)
  const assessment = await assessWithFallback(transcript, {
    vehicle_type: vehicle_type as string | undefined,
    can_transport: can_transport as boolean | undefined,
    existing_atmist: existing_atmist as Record<string, any> | undefined,
    session_callsign: (session_data as any)?.callsign ?? null,
    session_operator_id: (session_data as any)?.operator_id ?? null,
  });

  // Step 3: Build and save report locally
  const session = await getSession();
  const report: HeraldReport = {
    id: (report_id as string) || crypto.randomUUID(),
    timestamp: item.createdAt,
    transcript,
    assessment,
    status: 'active',
    synced: false,
    session_callsign: session?.callsign ?? (session_data as any)?.callsign ?? null,
    session_operator_id: session?.operator_id ?? (session_data as any)?.operator_id ?? null,
    session_service: session?.service ?? (session_data as any)?.service ?? null,
    session_station: session?.station ?? (session_data as any)?.station ?? null,
  };

  await saveReport(report);

  // Step 4: Sync to Supabase
  const payload = await toSyncPayload(report);
  const ok = await syncReport(payload);
  if (ok) {
    await markSynced(report.id);
  }
  // Even if sync fails, the report is saved locally and useHeraldSync will retry
}

async function assessWithFallback(
  transcript: string,
  context: {
    vehicle_type?: string;
    can_transport?: boolean;
    existing_atmist?: Record<string, any>;
    session_callsign?: string | null;
    session_operator_id?: string | null;
  },
): Promise<Assessment> {
  try {
    return await assessTranscript(transcript, {
      vehicle_type: context.vehicle_type,
      can_transport: context.can_transport,
      existing_atmist: context.existing_atmist,
    });
  } catch {
    return {
      service: 'unknown',
      protocol: 'NONE',
      priority: null,
      priority_label: null,
      headline: transcript.substring(0, 80),
      incident_type: 'Unknown',
      major_incident: false,
      scene_location: null,
      receiving_hospital: [],
      clinical_findings: {
        A: 'Not assessed',
        B: 'Not assessed',
        C: 'Not assessed',
        D: 'Not assessed',
        E: 'Not assessed',
      },
      atmist: {},
      treatment_given: [],
      action_items: [],
      structured: {
        callsign: context.session_callsign ?? null,
        incident_number: null,
        operator_id: context.session_operator_id ?? null,
      },
      actions: ['AI assessment unavailable — queued sync fallback used'],
      formatted_report: transcript,
      clinical_history: '',
    } as unknown as Assessment;
  }
}

/** Sync a queued report to Supabase */
async function processSyncReport(item: QueueItem): Promise<void> {
  const ok = await syncReport(item.payload);
  if (!ok) throw new Error('Sync report returned non-201');
}

/** Sync a queued disposition to Supabase */
async function processSyncDisposition(item: QueueItem): Promise<void> {
  const ok = await syncDisposition(item.payload);
  if (!ok) throw new Error('Sync disposition failed');
}

/** Execute a queued transfer operation */
async function processTransfer(item: QueueItem): Promise<void> {
  const action = item.payload.action as string;

  if (action === 'initiate') {
    const result = await initiateTransfer(item.payload as any);
    if (!result.ok) throw new Error(result.error ?? 'Transfer initiate failed');
  } else if (action === 'accept') {
    const result = await acceptTransfer(
      item.payload.transfer_id as string,
      item.payload.accepting_callsign as string,
    );
    if (!result.ok) throw new Error(result.error ?? 'Transfer accept failed');
  } else if (action === 'decline') {
    const result = await declineTransfer(
      item.payload.transfer_id as string,
      item.payload.declining_callsign as string,
      item.payload.reason as string | undefined,
    );
    if (!result.ok) throw new Error(result.error ?? 'Transfer decline failed');
  } else {
    throw new Error(`Unknown transfer action: ${action}`);
  }
}
