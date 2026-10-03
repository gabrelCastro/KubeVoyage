package dev.kubelearn.api.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;

/** A clock tests can move forward, to exercise expiry without waiting. */
public final class MutableClock extends Clock {

	private final AtomicReference<Instant> now = new AtomicReference<>(Instant.now());

	public void advance(Duration d) {
		now.updateAndGet((t) -> t.plus(d));
	}

	@Override
	public Instant instant() {
		return now.get();
	}

	@Override
	public ZoneId getZone() {
		return ZoneOffset.UTC;
	}

	@Override
	public Clock withZone(ZoneId zone) {
		return this;
	}

}
