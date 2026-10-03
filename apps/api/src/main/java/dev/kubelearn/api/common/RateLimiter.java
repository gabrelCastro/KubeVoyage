package dev.kubelearn.api.common;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Fixed-window counters, in memory. Enough for one instance; behind several instances
 * this would move to Postgres or Redis.
 */
@Component
public class RateLimiter {

	private record Window(Instant resetAt, int count) {
	}

	private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

	private final Clock clock;

	RateLimiter(Clock clock) {
		this.clock = clock;
	}

	/** Count one hit against {@code key}; throws if that exceeds {@code max} per {@code window}. */
	public void hit(String key, int max, Duration window) {
		var now = clock.instant();
		var w = windows.compute(key, (k, cur) -> cur == null || !now.isBefore(cur.resetAt())
				? new Window(now.plus(window), 1) : new Window(cur.resetAt(), cur.count() + 1));
		if (w.count() > max) {
			throw new TooManyRequestsException(Duration.between(now, w.resetAt()));
		}
	}

	@Scheduled(fixedDelayString = "PT5M")
	void evictExpired() {
		var now = clock.instant();
		windows.values().removeIf((w) -> !now.isBefore(w.resetAt()));
	}

}
