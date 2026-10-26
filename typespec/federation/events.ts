import {
  isCommandID,
  isPrincipalDID,
  isPrincipalType,
  type PrincipalDID,
  type PrincipalType,
} from "../directory/directory.ts";
import { isCommandKind } from "./commands.ts";

export type EventKind = string;
export type EventID = string;
export type AggregateType = string;

export function isEventKind(value: unknown): value is EventKind {
  return isCommandKind(value);
}

export function isEventID(value: unknown): value is EventID {
  return isCommandID(value);
}

export function isAggregateType(value: unknown): value is AggregateType {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(value)
  );
}

export interface DeliverEventRequest {
  event_id: EventID;
  kind: EventKind;
  destination_principal_type: PrincipalType;
  destination_principal_did: PrincipalDID;
  aggregate_type: AggregateType;
  aggregate_id: string;
  aggregate_version: number;
  payload: Record<string, unknown>;
}

export function validateDeliverEventRequest(
  request: DeliverEventRequest,
): string[] {
  const fields: string[] = [];
  if (!isEventID(request.event_id)) fields.push("event_id");
  if (!isEventKind(request.kind)) fields.push("kind");
  if (!isPrincipalType(request.destination_principal_type)) {
    fields.push("destination_principal_type");
  } else if (!isPrincipalDID(request.destination_principal_did)) {
    fields.push("destination_principal_did");
  }
  if (!isAggregateType(request.aggregate_type)) fields.push("aggregate_type");
  const length = [...request.aggregate_id].length;
  if (length < 1 || length > 200 || request.aggregate_id.trim() === "") {
    fields.push("aggregate_id");
  }
  if (
    !Number.isSafeInteger(request.aggregate_version) ||
    request.aggregate_version < 1
  ) {
    fields.push("aggregate_version");
  }
  if (
    typeof request.payload !== "object" ||
    request.payload === null ||
    Array.isArray(request.payload)
  ) {
    fields.push("payload");
  }
  return fields;
}

export const EventApplied = "applied" as const;
export const EventSuperseded = "superseded" as const;
export const EventDuplicate = "duplicate" as const;
export type EventDeliveryOutcome =
  | typeof EventApplied
  | typeof EventSuperseded
  | typeof EventDuplicate;

export function isEventDeliveryOutcome(
  value: unknown,
): value is EventDeliveryOutcome {
  return (
    value === EventApplied ||
    value === EventSuperseded ||
    value === EventDuplicate
  );
}

export interface EventReceipt {
  outcome: EventDeliveryOutcome;
}
