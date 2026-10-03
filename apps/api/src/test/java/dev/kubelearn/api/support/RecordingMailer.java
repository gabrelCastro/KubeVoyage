package dev.kubelearn.api.support;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;

import dev.kubelearn.api.auth.MagicLinkMailer;

/** Stands in for SMTP: remembers every link, so tests can "open the email". */
public final class RecordingMailer implements MagicLinkMailer {

	private static final Pattern TOKEN = Pattern.compile("#token=([A-Za-z0-9_-]+)$");

	private final Map<String, List<String>> links = new ConcurrentHashMap<>();

	@Override
	public void send(String email, String link, Duration validFor) {
		links.computeIfAbsent(email.toLowerCase(), (k) -> new CopyOnWriteArrayList<>()).add(link);
	}

	public String lastLink(String email) {
		var list = links.getOrDefault(email.toLowerCase(), List.of());
		if (list.isEmpty()) {
			throw new AssertionError("no sign-in email was sent to " + email);
		}
		return list.getLast();
	}

	public String lastToken(String email) {
		var m = TOKEN.matcher(lastLink(email));
		if (!m.find()) {
			throw new AssertionError("link has no token fragment: " + lastLink(email));
		}
		return m.group(1);
	}

}
