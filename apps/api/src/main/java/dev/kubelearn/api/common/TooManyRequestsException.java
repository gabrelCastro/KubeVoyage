package dev.kubelearn.api.common;

import java.time.Duration;

public class TooManyRequestsException extends RuntimeException {

	private final Duration retryAfter;

	public TooManyRequestsException(Duration retryAfter) {
		super("Too many requests");
		this.retryAfter = retryAfter;
	}

	public Duration retryAfter() {
		return retryAfter;
	}

}
