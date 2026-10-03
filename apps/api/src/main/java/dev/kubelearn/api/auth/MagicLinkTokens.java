package dev.kubelearn.api.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Single-use sign-in tokens. The raw token only ever exists in the email; the database
 * keeps its SHA-256, so a leaked table can't be used to sign in. Consuming is one atomic
 * {@code DELETE … RETURNING}: two clicks on the same link can't both succeed.
 */
@Component
public class MagicLinkTokens {

	private static final Logger log = LoggerFactory.getLogger(MagicLinkTokens.class);

	private static final SecureRandom RANDOM = new SecureRandom();

	private final JdbcClient jdbc;

	private final Clock clock;

	MagicLinkTokens(JdbcClient jdbc, Clock clock) {
		this.jdbc = jdbc;
		this.clock = clock;
	}

	/** Create a token for {@code email}, valid for {@code ttl}. Returns the raw token. */
	public String issue(String email, Duration ttl) {
		var bytes = new byte[32];
		RANDOM.nextBytes(bytes);
		var token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
		jdbc.sql("INSERT INTO magic_link_token (token_hash, email, expires_at) VALUES (?, ?, ?)")
			.param(hash(token))
			.param(email)
			.param(now().plus(ttl))
			.update();
		return token;
	}

	/** Spend a token. Returns the email it was issued for, if it existed and hadn't expired. */
	public Optional<String> consume(String token) {
		record Row(String email, OffsetDateTime expiresAt) {
		}
		return jdbc.sql("DELETE FROM magic_link_token WHERE token_hash = ? RETURNING email, expires_at")
			.param(hash(token))
			.query((rs, n) -> new Row(rs.getString("email"), rs.getObject("expires_at", OffsetDateTime.class)))
			.optional()
			.filter((row) -> row.expiresAt().isAfter(now()))
			.map(Row::email);
	}

	@Scheduled(fixedDelayString = "PT15M", initialDelayString = "PT1M")
	void purgeExpired() {
		int purged = jdbc.sql("DELETE FROM magic_link_token WHERE expires_at < ?").param(now()).update();
		if (purged > 0) {
			log.debug("Purged {} expired sign-in links", purged);
		}
	}

	private OffsetDateTime now() {
		return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
	}

	static byte[] hash(String token) {
		try {
			return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

}
