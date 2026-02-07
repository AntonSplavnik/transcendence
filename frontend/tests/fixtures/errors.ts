import type { AxiosError } from 'axios';
import type { ApiError, ApiErrorResponse } from '../../src/api/types';
import type { StoredError } from '../../src/api/error';

export function createMockApiError(overrides?: Partial<ApiError>): ApiError {
	return {
		code: 400,
		name: 'BadRequest',
		brief: 'InvalidRequest',
		detail: 'The request was invalid',
		...overrides,
	};
}

export function createMockAxiosError(
	status: number,
	errorData?: Partial<ApiError>
): AxiosError<ApiErrorResponse> {
	const apiError = errorData ? createMockApiError(errorData) : undefined;

	return {
		isAxiosError: true,
		name: 'AxiosError',
		message: `Request failed with status code ${status}`,
		config: {} as any,
		request: {},
		response: apiError
			? {
					status,
					statusText: 'Error',
					headers: {},
					config: {} as any,
					data: { error: apiError },
			  }
			: undefined,
		toJSON: () => ({}),
	} as AxiosError<ApiErrorResponse>;
}

export function createMockNetworkError(): AxiosError<ApiErrorResponse> {
	return {
		isAxiosError: true,
		name: 'AxiosError',
		message: 'Network Error',
		config: {} as any,
		request: {},
		response: undefined,
		toJSON: () => ({}),
	} as AxiosError<ApiErrorResponse>;
}

export function createMockStoredError(overrides?: Partial<StoredError>): StoredError {
	return {
		type: 'error',
		message: 'An error occurred',
		timestamp: Date.now(),
		...overrides,
	};
}
