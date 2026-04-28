export interface CrewRowLike {
  operator_id: string | null;
  used_at: string | null;
}

export function normalizeLatestCrewRows<T extends CrewRowLike>(rows: T[]): T[] {
  const latestByOperator = new Map<string, T>();
  for (const row of rows) {
    const operatorKey = (row.operator_id ?? '').trim();
    if (!operatorKey) continue;
    const existing = latestByOperator.get(operatorKey);
    const existingTs = existing?.used_at ? new Date(existing.used_at).getTime() : 0;
    const nextTs = row.used_at ? new Date(row.used_at).getTime() : 0;
    if (!existing || nextTs >= existingTs) {
      latestByOperator.set(operatorKey, row);
    }
  }
  return Array.from(latestByOperator.values()).sort((a, b) => {
    const aTs = a.used_at ? new Date(a.used_at).getTime() : 0;
    const bTs = b.used_at ? new Date(b.used_at).getTime() : 0;
    return bTs - aTs;
  });
}
