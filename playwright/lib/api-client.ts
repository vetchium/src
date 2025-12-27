/**
 * Generic API response wrapper for test assertions.
 */
export interface APIResponse<T> {
	status: number;
	body: T;
	errors?: string[];
}
