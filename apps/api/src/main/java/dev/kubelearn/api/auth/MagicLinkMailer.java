package dev.kubelearn.api.auth;

import java.time.Duration;

/** Delivers sign-in links. Implementations must not throw: delivery is best effort. */
public interface MagicLinkMailer {

	void send(String email, String link, Duration validFor);

}
