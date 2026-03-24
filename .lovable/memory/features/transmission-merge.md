Rules for transmission consolidation and action item resolution

- mergeShallow for top-level assessment fields: empty/null/dash in new = keep existing
- deepMergeCasualtyMap for ATMIST: per-field preservation, never wipe unmentioned casualties
- treatment_given: deduplicated array merge, not replace
- structured fields: mergeShallow, not replace
- receiving_hospital: only overwrite if new transmission explicitly provides one
- priority/headline: only overwrite in updatePayload if new transmission provides non-empty value
- Action items: silence is NOT resolution. Only explicit confirmation in transcript triggers resolution.
- HEMS resolves on: tasked, en route, on scene, landed, arrived, taking over, stood down, cancelled
- Hospital resolves on: receiving_hospital array populated, or "conveying/transporting to [NAME]"
- Extrication resolves on: extricated, extrication complete/done, freed, released
- Triage resolves on: triage complete/done, all casualties assessed/accounted
- Additional units/backup resolves on: on scene, arrived, confirmed
