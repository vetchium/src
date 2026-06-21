import type { ValidationError } from "vetchium-specs/common/common";

/**
 * Generic API response wrapper for test assertions.
 */
export interface APIResponse<T> {
	status: number;
	body: T;
	errors?: ValidationError[];
}
