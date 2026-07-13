# Mission workflow design

This document defines the operational model used by the initial mission CRUD.
A mission is an intentional operational record, not merely a
period in which telemetry was received.

## Core relationships

- An occurrence may have zero or many missions.
- A mission belongs to at most one occurrence.
- A mission has one primary drone, controller and pilot for the MVP.
- The active pilot is confirmed through `pilot_sessions`, not through a name
  manually typed into the mission.
- Telemetry, tracks, livestreams and media are attached to the active mission.
- Telemetry received without an active mission is retained as unassigned data
  and may be associated later by an authorized operator.

## State machine

```text
draft -> ready -> active -> completed -> archived
   |       |        |
   +------>+------> aborted
```

- `draft`: mission details and resources may still change.
- `ready`: mandatory resources and safety checklist have been validated.
- `active`: operational clock is running and incoming data is associated.
- `completed`: operation ended normally; report data is immutable by default.
- `aborted`: operation ended without completion; a reason is mandatory.
- `archived`: administrative closure after report review.

State transitions are explicit commands, audited with actor, timestamp and
reason. Telemetry alone never starts or completes a mission.

## Readiness rules

Before moving to `ready`:

- occurrence selected, unless the mission is explicitly marked as training;
- pilot, drone and controller assigned;
- assigned assets are not already used by another active mission;
- pilot account is active and has the `Piloto` role;
- drone and controller belong to the same organisation;
- pre-flight checklist completed;
- mission title, objective and operational area recorded.

Before moving to `active`:

- a current `pilot_session` matches the assigned pilot and controller;
- the expected drone is connected to that controller;
- no other active mission uses the same drone or controller.

## Data association

When activation succeeds, the API records a mission activation event and opens
a flight-track segment. The MQTT consumer resolves the active mission using the
gateway and aircraft serials, then writes `mission_id`, `drone_id` and
`controller_id` on new telemetry points. Livestream and media callbacks use the
same resolver.

If connectivity drops, the mission remains active. Online/offline is device
state, not mission state. A reconnect continues the same mission and opens a
new track segment only when technically necessary.

## Completion and reporting

Completing a mission records:

- end timestamp and closing operator;
- outcome and operational notes;
- final telemetry/track statistics;
- media and livestream references;
- incidents, warnings and aborted actions;
- report generation status.

The report service generates a versioned PDF snapshot. Later data corrections
create a new report version instead of overwriting the previous document.

## Proposed schema additions

- `mission_events`: immutable state and timeline events.
- `mission_assignments`: crew and operational roles beyond the primary pilot.
- `mission_checklist_items`: pre-flight and post-flight confirmations.
- `mission_notes`: timestamped operational notes.
- `mission_reports`: report version and approval metadata, linked to
  `report_documents`.
- partial unique indexes preventing multiple active missions for the same drone
  or controller.

## Delivery sequence

1. **In progress:** extend the mission schema, add immutable creation events
   and model multiple `flights` per mission.
2. **In progress:** build local occurrence and mission creation/listing with
   organisation isolation and resource-assignment fields.
3. Implement readiness validation and start/complete commands.
4. Associate incoming telemetry through active pilot/device sessions.
5. Add mission timeline, checklist and operational notes.
6. Generate and approve versioned mission reports.
7. Add multi-crew assignments and advanced incident workflows.

## External occurrence source

Migration `006_operations_workflow.sql` reserves `external_source`,
`external_id` and `external_payload` on occurrences. No connector, endpoint or
payload for the external occurrence SaaS is assumed. The adapter will be added
only after its official API contract, authentication method, pagination,
filtering and update semantics are available.
