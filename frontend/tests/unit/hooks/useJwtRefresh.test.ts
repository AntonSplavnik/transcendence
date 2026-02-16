import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJwtRefresh } from '../../../src/hooks/useJwtRefresh';
import { createMockSession } from '../../fixtures/users';
import { server } from '../../helpers/msw-handlers';
import { createMockApiError } from '../../fixtures/errors';
import { http, HttpResponse } from 'msw';

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

function makeSession(minutesFromNow: number) {
	const expiry = new Date(Date.now() + minutesFromNow * 60 * 1000);
	return createMockSession({ access_expiry: expiry.toISOString() });
}

function mockRefreshSuccess(minutesFromNow: number = 15) {
	const newSession = makeSession(minutesFromNow);
	server.use(
		http.post('/api/auth/session-management/refresh-jwt', () => {
			return HttpResponse.json(newSession);
		})
	);
	return newSession;
}

function mockRefreshFailure(brief: string) {
	server.use(
		http.post('/api/auth/session-management/refresh-jwt', () => {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief }) },
				{ status: 401 }
			);
		})
	);
}

function mockRefreshNetworkError() {
	server.use(
		http.post('/api/auth/session-management/refresh-jwt', () => {
			return HttpResponse.error();
		})
	);
}

describe('useJwtRefresh', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('schedules refresh based on access_expiry (fires at expiry - 60s)', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		const session = makeSession(15); // 15 min from now
		const expectedSession = mockRefreshSuccess();

		renderHook(() => useJwtRefresh({
			session,
			onSessionUpdate,
			onAuthLost,
		}));

		// Should NOT have fired yet at 13 minutes
		await act(async () => {
			vi.advanceTimersByTime(13 * 60 * 1000);
		});
		expect(onSessionUpdate).not.toHaveBeenCalled();

		// Should fire at 14 minutes (15 min - 60s buffer)
		await act(async () => {
			vi.advanceTimersByTime(1 * 60 * 1000);
		});
		expect(onSessionUpdate).toHaveBeenCalledWith(expectedSession);
	});

	it('does not schedule a timer when session is null', () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();

		renderHook(() => useJwtRefresh({
			session: null,
			onSessionUpdate,
			onAuthLost,
		}));

		vi.advanceTimersByTime(20 * 60 * 1000);
		expect(onSessionUpdate).not.toHaveBeenCalled();
	});

	it('cancels timer when session becomes null (logout)', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		mockRefreshSuccess();

		const { rerender } = renderHook(
			({ session }) => useJwtRefresh({ session, onSessionUpdate, onAuthLost }),
			{ initialProps: { session: makeSession(15) as ReturnType<typeof makeSession> | null } }
		);

		// Logout — session becomes null
		rerender({ session: null });

		// Advance past when the refresh would have fired
		await act(async () => {
			vi.advanceTimersByTime(15 * 60 * 1000);
		});
		expect(onSessionUpdate).not.toHaveBeenCalled();
	});

	it('reschedules when session changes', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		const expectedSession = mockRefreshSuccess();

		const { rerender } = renderHook(
			({ session }) => useJwtRefresh({ session, onSessionUpdate, onAuthLost }),
			{ initialProps: { session: makeSession(15) } }
		);

		// After 5 minutes, session gets updated with new expiry (10 min from now)
		await act(async () => {
			vi.advanceTimersByTime(5 * 60 * 1000);
		});
		expect(onSessionUpdate).not.toHaveBeenCalled();

		rerender({ session: makeSession(10) });

		// New timer should fire at 10 min - 60s = 9 min from now
		await act(async () => {
			vi.advanceTimersByTime(9 * 60 * 1000);
		});
		expect(onSessionUpdate).toHaveBeenCalledWith(expectedSession);
	});

	it('calls onAuthLost on NeedReauth and does not retry', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		mockRefreshFailure('NeedReauth');

		renderHook(() => useJwtRefresh({
			session: makeSession(2), // fires in ~1 min
			onSessionUpdate,
			onAuthLost,
		}));

		await act(async () => {
			vi.advanceTimersByTime(2 * 60 * 1000);
		});
		expect(onAuthLost).toHaveBeenCalledTimes(1);
		expect(onSessionUpdate).not.toHaveBeenCalled();

		// Should not retry
		await act(async () => {
			vi.advanceTimersByTime(60 * 1000);
		});
		expect(onAuthLost).toHaveBeenCalledTimes(1);
	});

	it('retries with exponential backoff on network error', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		mockRefreshNetworkError();

		renderHook(() => useJwtRefresh({
			session: makeSession(2), // fires in ~1 min
			onSessionUpdate,
			onAuthLost,
		}));

		// First attempt fires at ~1 min
		await act(async () => {
			vi.advanceTimersByTime(60 * 1000);
		});
		expect(onSessionUpdate).not.toHaveBeenCalled();
		expect(onAuthLost).not.toHaveBeenCalled();

		// First retry at 5s
		await act(async () => {
			vi.advanceTimersByTime(5_000);
		});
		expect(onAuthLost).not.toHaveBeenCalled();

		// Second retry at 10s
		await act(async () => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onAuthLost).not.toHaveBeenCalled();

		// Now let the next retry succeed
		const expectedSession = mockRefreshSuccess();
		await act(async () => {
			vi.advanceTimersByTime(20_000);
		});
		expect(onSessionUpdate).toHaveBeenCalledWith(expectedSession);
	});

	it('triggers immediate refresh on visibility change when near expiry', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		const expectedSession = mockRefreshSuccess();

		// Session expires in 30 seconds (within 60s buffer)
		renderHook(() => useJwtRefresh({
			session: makeSession(0.5), // 30 seconds
			onSessionUpdate,
			onAuthLost,
		}));

		// Simulate tab becoming visible
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		await act(async () => {
			document.dispatchEvent(new Event('visibilitychange'));
		});

		expect(onSessionUpdate).toHaveBeenCalledWith(expectedSession);
	});

	it('does not trigger refresh on visibility change when not near expiry', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		mockRefreshSuccess();

		// Session has plenty of time (15 min)
		renderHook(() => useJwtRefresh({
			session: makeSession(15),
			onSessionUpdate,
			onAuthLost,
		}));

		// Simulate tab becoming visible
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		await act(async () => {
			document.dispatchEvent(new Event('visibilitychange'));
		});

		expect(onSessionUpdate).not.toHaveBeenCalled();
	});

	it('clamps minimum delay to 5 seconds for past expiry', async () => {
		const onSessionUpdate = vi.fn();
		const onAuthLost = vi.fn();
		const expectedSession = mockRefreshSuccess();

		// Session already expired
		const pastSession = createMockSession({
			access_expiry: new Date(Date.now() - 60 * 1000).toISOString(),
		});

		renderHook(() => useJwtRefresh({
			session: pastSession,
			onSessionUpdate,
			onAuthLost,
		}));

		// Should NOT fire immediately (0ms)
		expect(onSessionUpdate).not.toHaveBeenCalled();

		// Should fire after the minimum 5s delay
		await act(async () => {
			vi.advanceTimersByTime(5_000);
		});
		expect(onSessionUpdate).toHaveBeenCalledWith(expectedSession);
	});
});
