import type { Assessment } from './herald-types';

export interface DiffChange {
  field: string;
  original: string;
  corrected: string;
}

export interface ReportDiff {
  fields_changed: string[];
  changes: DiffChange[];
  actions_added: string[];
  actions_removed: string[];
  headline_changed: boolean;
  priority_changed: boolean;
  original_priority?: string;
  corrected_priority?: string;
  has_edits: boolean;
}

export function computeDiff(original: Assessment, final: Assessment): ReportDiff {
  const changes: DiffChange[] = [];
  const fieldsChanged: string[] = [];

  // Headline
  const headlineChanged = original.headline !== final.headline;
  if (headlineChanged) {
    fieldsChanged.push('headline');
    changes.push({ field: 'headline', original: original.headline, corrected: final.headline });
  }

  // Priority
  const priorityChanged = original.priority !== final.priority;
  if (priorityChanged) {
    fieldsChanged.push('priority');
    changes.push({ field: 'priority', original: original.priority, corrected: final.priority });
  }

  // Structured fields
  const allKeys = new Set([
    ...Object.keys(original.structured || {}),
    ...Object.keys(final.structured || {}),
  ]);
  for (const key of allKeys) {
    const ov = (original.structured?.[key] ?? '') as string;
    const fv = (final.structured?.[key] ?? '') as string;
    if (ov !== fv) {
      fieldsChanged.push(key);
      changes.push({ field: key, original: ov, corrected: fv });
    }
  }

  // Formatted report
  if (original.formatted_report !== final.formatted_report) {
    fieldsChanged.push('formatted_report');
    changes.push({
      field: 'formatted_report',
      original: original.formatted_report,
      corrected: final.formatted_report,
    });
  }

  // Actions
  const origActions = original.actions || [];
  const finalActions = final.actions || [];
  const actionsAdded = finalActions.filter((a) => !origActions.includes(a));
  const actionsRemoved = origActions.filter((a) => !finalActions.includes(a));
  if (actionsAdded.length > 0 || actionsRemoved.length > 0) {
    fieldsChanged.push('actions');
  }

  const hasEdits = fieldsChanged.length > 0;

  return {
    fields_changed: fieldsChanged,
    changes,
    actions_added: actionsAdded,
    actions_removed: actionsRemoved,
    headline_changed: headlineChanged,
    priority_changed: priorityChanged,
    ...(priorityChanged ? { original_priority: original.priority, corrected_priority: final.priority } : {}),
    has_edits: hasEdits,
  };
}
