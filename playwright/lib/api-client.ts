import type { ValidationError } from "../../specs/typespec/common/common";

/**
 * Generic API response wrapper for test assertions.
 */
export interface APIResponse<T> {
	status: number;
	body: T;
	errors?: ValidationError[];
}
