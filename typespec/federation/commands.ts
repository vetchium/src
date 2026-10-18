import {
  type CommandID,
  isCommandID,
  isPrincipalDID,
  isPrincipalType,
  type PrincipalDID,
  type PrincipalType,
} from "../directory/directory.ts";

export type CommandKind = string;

export function isCommandKind(value: unknown): value is CommandKind {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)
  );
}

export interface ExecuteCommandRequest {
  command_id: CommandID;
  correlation_id: CommandID;
  kind: CommandKind;
  authority_principal_type: PrincipalType;
  authority_principal_did: PrincipalDID;
  aggregate_id: string;
  payload: Record<string, unknown>;
}

export function validateExecuteCommandRequest(
  request: ExecuteCommandRequest,
): string[] {
  const fields: string[] = [];
  if (!isCommandID(request.command_id)) fields.push("command_id");
  if (!isCommandID(request.correlation_id)) fields.push("correlation_id");
  if (!isCommandKind(request.kind)) fields.push("kind");
  if (!isPrincipalType(request.authority_principal_type)) {
    fields.push("authority_principal_type");
  } else if (!isPrincipalDID(request.authority_principal_did)) {
    fields.push("authority_principal_did");
  }
  const length = [...request.aggregate_id].length;
  if (length < 1 || length > 200 || request.aggregate_id.trim() === "") {
    fields.push("aggregate_id");
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

export interface CommandResult {
  status: number;
  body: unknown;
}

/** A stored outcome: a success or a deterministic rejection. */
export function isCommandResult(value: CommandResult): boolean {
  return (
    Number.isInteger(value.status) &&
    ((value.status >= 200 && value.status < 300) ||
      (value.status >= 400 && value.status < 500)) &&
    value.body !== undefined
  );
}
