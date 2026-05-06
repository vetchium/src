import {
	type ValidationError,
	newValidationError,
	ERR_REQUIRED,
} from "../common/common";

export type ConnectionState =
	| "not_connected"
	| "ineligible"
	| "request_sent"
	| "request_received"
	| "connected"
	| "i_rejected_their_request"
	| "they_rejected_my_request"
	| "i_disconnected"
	| "they_disconnected"
	| "i_blocked_them"
	| "blocked_by_them";

export interface Connection {
	handle: string;
	display_name: string;
	short_bio?: string;
	has_profile_picture: boolean;
	profile_picture_url?: string;
	connected_at: string;
}

export interface PendingRequest {
	handle: string;
	display_name: string;
	short_bio?: string;
	has_profile_picture: boolean;
	profile_picture_url?: string;
	created_at: string;
}

export interface BlockedUser {
	handle: string;
	display_name: string;
	blocked_at: string;
}

export interface HandleRequest {
	handle: string;
}

export interface GetStatusRequest {
	handle: string;
}

export interface GetStatusResponse {
	connection_state: ConnectionState;
}

export interface ListConnectionsRequest {
	filter_query?: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListConnectionsResponse {
	connections: Connection[];
	next_pagination_key?: string;
}

export interface ListPendingRequestsRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ListIncomingRequestsResponse {
	incoming: PendingRequest[];
	next_pagination_key?: string;
}

export interface ListOutgoingRequestsResponse {
	outgoing: PendingRequest[];
	next_pagination_key?: string;
}

export interface ListBlockedRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ListBlockedResponse {
	blocked: BlockedUser[];
	next_pagination_key?: string;
}

export interface SearchConnectionsRequest {
	query: string;
}

export interface SearchConnectionsResponse {
	results: Connection[];
}

export interface ConnectionCounts {
	pending_incoming: number;
	pending_outgoing: number;
	connected: number;
	blocked: number;
}

export function validateHandleRequest(
	request: HandleRequest
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!request.handle || request.handle.trim() === "") {
		errors.push(newValidationError("handle", ERR_REQUIRED));
	}
	return errors;
}

export function validateGetStatusRequest(
	request: GetStatusRequest
): ValidationError[] {
	return validateHandleRequest(request);
}

export function validateListConnectionsRequest(
	_request: ListConnectionsRequest
): ValidationError[] {
	return [];
}

export function validateListPendingRequestsRequest(
	_request: ListPendingRequestsRequest
): ValidationError[] {
	return [];
}

export function validateListBlockedRequest(
	_request: ListBlockedRequest
): ValidationError[] {
	return [];
}

export function validateSearchConnectionsRequest(
	request: SearchConnectionsRequest
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!request.query || request.query.trim() === "") {
		errors.push(newValidationError("query", ERR_REQUIRED));
	}
	return errors;
}
