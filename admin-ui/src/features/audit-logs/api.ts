import type {
  ListRequest,
  ListResponse,
} from "typespec/admin/audit-logs/events";
import { requestJson } from "../../api/client";
export function listAuditEvents(request: ListRequest): Promise<ListResponse> {
  return requestJson("/admin/list-audit-events", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
