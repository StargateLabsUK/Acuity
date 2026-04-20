import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type CrewStatus = "available" | "on_incident" | "handover_only";

const FINAL_DISPOSITIONS = new Set([
  "conveyed",
  "see_and_treat",
  "see_and_refer",
  "refused_transport",
  "role",
  "transferred",
]);

type SupabaseClient = ReturnType<typeof createClient>;

function inferCasualtyKeysFromAssessment(assessment: unknown): string[] {
  if (!assessment || typeof assessment !== "object") return [];
  const atmist = (assessment as Record<string, unknown>).atmist;
  if (!atmist || typeof atmist !== "object" || Array.isArray(atmist)) return [];
  return Object.keys(atmist as Record<string, unknown>);
}

function getTransferIdFromFields(fields: unknown): string | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const transferId = (fields as Record<string, unknown>).transfer_id;
  return typeof transferId === "string" && transferId.trim() ? transferId.trim() : null;
}

export async function getCasualtyKeysForReport(
  supabase: SupabaseClient,
  reportId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("herald_reports")
    .select("assessment")
    .eq("id", reportId)
    .maybeSingle();

  const keys = inferCasualtyKeysFromAssessment(data?.assessment ?? null);
  return keys.length > 0 ? keys : ["P3"];
}

export function isFinalDisposition(disposition: string | null | undefined): boolean {
  return !!disposition && FINAL_DISPOSITIONS.has(disposition);
}

async function hasOpenOwnedCasualtiesForShiftOnReport(
  supabase: SupabaseClient,
  shiftId: string,
  reportId: string,
): Promise<boolean> {
  const casualtyKeys = await getCasualtyKeysForReport(supabase, reportId);
  const { data: dispositions } = await supabase
    .from("casualty_dispositions")
    .select("casualty_key, disposition, fields")
    .eq("report_id", reportId);

  const byKey = new Map<string, { disposition: string | null; fields: unknown }>();
  const transferIds = new Set<string>();
  for (const row of dispositions ?? []) {
    byKey.set(row.casualty_key, { disposition: row.disposition, fields: row.fields });
    if (row.disposition === "transferred") {
      const transferId = getTransferIdFromFields(row.fields);
      if (transferId) transferIds.add(transferId);
    }
  }

  let acceptedByShift = new Set<string>();
  if (transferIds.size > 0) {
    const ids = Array.from(transferIds);
    const { data: acceptedTransfers } = await supabase
      .from("patient_transfers")
      .select("id")
      .in("id", ids)
      .eq("from_shift_id", shiftId)
      .eq("status", "accepted");
    acceptedByShift = new Set((acceptedTransfers ?? []).map((row) => row.id));
  }

  for (const key of casualtyKeys) {
    const row = byKey.get(key);
    if (!row) {
      return true;
    }
    if (isFinalDisposition(row.disposition)) {
      continue;
    }
    if (row.disposition === "transferred") {
      const transferId = getTransferIdFromFields(row.fields);
      if (transferId && acceptedByShift.has(transferId)) {
        continue;
      }
    }
    return true;
  }

  return false;
}

async function hasOutstandingAcceptedTransfersForShift(
  supabase: SupabaseClient,
  shiftId: string,
): Promise<boolean> {
  const { data: accepted } = await supabase
    .from("patient_transfers")
    .select("report_id, casualty_key")
    .eq("to_shift_id", shiftId)
    .eq("status", "accepted");

  if (!accepted || accepted.length === 0) return false;

  for (const transfer of accepted) {
    const { data: disposition } = await supabase
      .from("casualty_dispositions")
      .select("disposition")
      .eq("report_id", transfer.report_id)
      .eq("casualty_key", transfer.casualty_key)
      .maybeSingle();

    if (!disposition || disposition.disposition === "transferred") {
      return true;
    }
  }

  return false;
}

export async function setShiftOnIncident(
  supabase: SupabaseClient,
  shiftId: string,
  reportId: string,
): Promise<void> {
  await supabase
    .from("shifts")
    .update({ active_report_id: reportId, crew_status: "on_incident" as CrewStatus })
    .eq("id", shiftId)
    .is("ended_at", null);
}

export async function markReceivingShiftHandoverOnlyIfIdle(
  supabase: SupabaseClient,
  shiftId: string | null | undefined,
): Promise<void> {
  if (!shiftId) return;

  const { data: shift } = await supabase
    .from("shifts")
    .select("id, ended_at, active_report_id")
    .eq("id", shiftId)
    .maybeSingle();

  if (!shift || shift.ended_at) return;
  if (shift.active_report_id) return;

  await supabase
    .from("shifts")
    .update({ crew_status: "handover_only" as CrewStatus })
    .eq("id", shiftId)
    .is("ended_at", null);
}

export async function recomputeCrewStatus(
  supabase: SupabaseClient,
  shiftId: string | null | undefined,
): Promise<CrewStatus | null> {
  if (!shiftId) return null;

  const { data: shift } = await supabase
    .from("shifts")
    .select("id, ended_at, active_report_id")
    .eq("id", shiftId)
    .maybeSingle();

  if (!shift || shift.ended_at) return null;

  let activeReportId: string | null = shift.active_report_id ?? null;
  if (activeReportId) {
    const { data: report } = await supabase
      .from("herald_reports")
      .select("id, status")
      .eq("id", activeReportId)
      .maybeSingle();

    if (report?.status === "active") {
      const hasOpenOwnedCasualties = await hasOpenOwnedCasualtiesForShiftOnReport(
        supabase,
        shiftId,
        activeReportId,
      );
      if (hasOpenOwnedCasualties) {
        await supabase
          .from("shifts")
          .update({ crew_status: "on_incident" as CrewStatus })
          .eq("id", shiftId)
          .is("ended_at", null);
        return "on_incident";
      }
    }

    activeReportId = null;
    await supabase
      .from("shifts")
      .update({ active_report_id: null })
      .eq("id", shiftId)
      .is("ended_at", null);
  }

  const hasOutstandingTransfers = await hasOutstandingAcceptedTransfersForShift(supabase, shiftId);
  const status: CrewStatus = hasOutstandingTransfers ? "handover_only" : "available";

  await supabase
    .from("shifts")
    .update({ crew_status: status, active_report_id: activeReportId })
    .eq("id", shiftId)
    .is("ended_at", null);

  return status;
}

export async function clearShiftActiveIncidentIfFullyDisposed(
  supabase: SupabaseClient,
  shiftId: string | null | undefined,
  reportId: string,
): Promise<void> {
  if (!shiftId) return;

  const keys = await getCasualtyKeysForReport(supabase, reportId);
  const { count } = await supabase
    .from("casualty_dispositions")
    .select("id", { head: true, count: "exact" })
    .eq("report_id", reportId);

  if ((count ?? 0) < keys.length) return;

  await supabase
    .from("shifts")
    .update({ active_report_id: null })
    .eq("id", shiftId)
    .eq("active_report_id", reportId)
    .is("ended_at", null);

  await recomputeCrewStatus(supabase, shiftId);
}

export async function evaluateAndCloseReportIfFinalized(
  supabase: SupabaseClient,
  reportId: string,
): Promise<{ closed: boolean; casualtyCount: number; finalizedCount: number; reportShiftId: string | null }> {
  const { data: reportRow } = await supabase
    .from("herald_reports")
    .select("assessment, status, shift_id")
    .eq("id", reportId)
    .maybeSingle();

  if (!reportRow) {
    return { closed: false, casualtyCount: 1, finalizedCount: 0, reportShiftId: null };
  }

  const keys = inferCasualtyKeysFromAssessment(reportRow.assessment);
  const casualtyCount = Math.max(1, keys.length);

  const { data: dispositions } = await supabase
    .from("casualty_dispositions")
    .select("casualty_key, disposition")
    .eq("report_id", reportId);

  const finalized = new Set<string>();
  for (const row of dispositions ?? []) {
    if (isFinalDisposition(row.disposition)) {
      finalized.add(row.casualty_key);
    }
  }

  const finalizedCount = finalized.size;
  const shouldClose = finalizedCount >= casualtyCount;

  if (shouldClose && reportRow.status !== "closed") {
    await supabase
      .from("herald_reports")
      .update({ status: "closed", confirmed_at: new Date().toISOString() })
      .eq("id", reportId);
  }

  return {
    closed: shouldClose,
    casualtyCount,
    finalizedCount,
    reportShiftId: reportRow.shift_id ?? null,
  };
}
