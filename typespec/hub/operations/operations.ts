import { isCommandID } from "../../directory/directory.ts";

export type OperationID = string;
export const Pending = "pending" as const;
export const Succeeded = "succeeded" as const;
export const Failed = "failed" as const;
export type OperationState = typeof Pending | typeof Succeeded | typeof Failed;

export function isOperationID(value: OperationID): boolean {
  return isCommandID(value);
}

export function isOperationState(value: string): value is OperationState {
  return value === Pending || value === Succeeded || value === Failed;
}

export interface PendingOperation {
  operation_id: OperationID;
}

export interface GetOperationRequest {
  operation_id: OperationID;
}

export function validateGetOperationRequest(
  request: GetOperationRequest,
): string[] {
  return isOperationID(request.operation_id) ? [] : ["operation_id"];
}

export interface OperationStatus {
  operation_id: OperationID;
  state: OperationState;
}
