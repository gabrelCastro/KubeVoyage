package dev.kubelearn.api.auth;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import dev.kubelearn.api.support.ApiTest;

import static org.assertj.core.api.Assertions.assertThat;

class SignInTest extends ApiTest {

	@Test
	void anonymousRequestsGetAJsonProblemNotARedirect() {
		var res = device().get("/api/me");
		assertThat(res.status()).isEqualTo(401);
		assertThat(res.headers().firstValue("content-type")).hasValueSatisfying((ct) -> assertThat(ct).startsWith("application/problem+json"));
		assertThat(res.json().get("code").asString()).isEqualTo("unauthenticated");
	}

	@Test
	void writesWithoutTheCsrfTokenAreRefused() {
		var d = signedIn(uniqueEmail());
		var res = d.putWithoutCsrf("/api/progress", "{\"lessons\":{},\"last\":null}");
		assertThat(res.status()).isEqualTo(403);
		assertThat(res.json().get("code").asString()).isEqualTo("csrf");
	}

	@Test
	void signingInIsCsrfProtectedToo() {
		var d = device();
		var res = d.putWithoutCsrf("/api/auth/magic-link", "{\"email\":\"x@example.com\"}");
		assertThat(res.status()).isIn(403, 405);
	}

	@Test
	void aMagicLinkCreatesTheAccountAndASecureSession() {
		var email = uniqueEmail();
		var d = device();
		var res = signIn(d, email);

		assertThat(res.json().get("email").asString()).isEqualTo(email);
		assertThat(res.json().get("providers").get(0).asString()).isEqualTo("email");
		assertThat(res.setCookie("kl_session")).hasValueSatisfying((c) -> assertThat(c).contains("HttpOnly").contains("SameSite=Lax").contains("Path=/"));
		assertThat(d.get("/api/me").json().get("email").asString()).isEqualTo(email);
	}

	@Test
	void theLinkPointsAtTheWebAppWithTheTokenInTheFragment() {
		var email = uniqueEmail();
		device().post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}");
		assertThat(mail.lastLink(email)).matches("http://localhost:5180/auth/verify#token=[A-Za-z0-9_-]{43}");
	}

	@Test
	void theSameAddressInAnyCaseIsTheSameAccount() {
		var email = uniqueEmail();
		var first = signIn(device(), email).json().get("id").asString();
		var second = signIn(device(), email.toUpperCase()).json().get("id").asString();
		assertThat(second).isEqualTo(first);
	}

	@Test
	void aLinkWorksOnlyOnce() {
		var email = uniqueEmail();
		var d = device();
		d.post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}");
		var token = mail.lastToken(email);
		assertThat(d.post("/api/auth/magic-link/verify", "{\"token\":\"" + token + "\"}").status()).isEqualTo(200);

		var again = device().post("/api/auth/magic-link/verify", "{\"token\":\"" + token + "\"}");
		assertThat(again.status()).isEqualTo(401);
		assertThat(again.json().get("code").asString()).isEqualTo("invalid_link");
	}

	@Test
	void aLinkExpires() {
		var email = uniqueEmail();
		var d = device();
		d.post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}");
		clock.advance(Duration.ofMinutes(11));
		var res = d.post("/api/auth/magic-link/verify", "{\"token\":\"" + mail.lastToken(email) + "\"}");
		assertThat(res.status()).isEqualTo(401);
	}

	@Test
	void tokensAreStoredOnlyAsHashes() {
		var email = uniqueEmail();
		device().post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}");
		var token = mail.lastToken(email);
		var stored = db.sql("SELECT count(*) FROM magic_link_token WHERE token_hash = ?").param(MagicLinkTokens.hash(token)).query(Long.class).single();
		var plain = db.sql("SELECT count(*) FROM magic_link_token WHERE encode(token_hash, 'escape') = ?").param(token).query(Long.class).single();
		assertThat(stored).isEqualTo(1);
		assertThat(plain).isZero();
	}

	@Test
	void garbageTokensAreRejectedWithoutTouchingTheDatabase() {
		var res = device().post("/api/auth/magic-link/verify", "{\"token\":\"'; DROP TABLE app_user; --\"}");
		assertThat(res.status()).isEqualTo(400);
	}

	@Test
	void signingInRotatesTheSessionIdAndTheOldOneStopsWorking() {
		var email = uniqueEmail();
		var d = signedIn(email);
		var before = d.cookie("kl_session").orElseThrow();
		signIn(d, email);
		var after = d.cookie("kl_session").orElseThrow();
		assertThat(after).isNotEqualTo(before);

		var replay = device();
		replay.forceSessionCookie(before);
		assertThat(replay.get("/api/me").status()).isEqualTo(401);
	}

	@Test
	void signingInRotatesTheCsrfTokenAndHandsOutTheNewOne() {
		var d = device();
		d.ensureCsrf();
		var before = d.cookie("XSRF-TOKEN").orElseThrow();
		var email = uniqueEmail();
		d.post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}");
		var res = d.post("/api/auth/magic-link/verify", "{\"token\":\"" + mail.lastToken(email) + "\"}");

		assertThat(res.setCookie("XSRF-TOKEN")).isPresent();
		assertThat(d.cookie("XSRF-TOKEN")).hasValueSatisfying((t) -> assertThat(t).isNotEqualTo(before));
		// and the very next write works without fetching a token first
		assertThat(d.put("/api/progress", "{\"lessons\":{},\"last\":null}").status()).isEqualTo(200);
	}

	@Test
	void tooManyLinksForOneAddressAreThrottled() {
		var email = uniqueEmail();
		var d = device();
		for (int i = 0; i < 3; i++) {
			assertThat(d.post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}").status()).isEqualTo(202);
		}
		var res = d.post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}");
		assertThat(res.status()).isEqualTo(429);
		assertThat(res.headers().firstValue("retry-after")).hasValueSatisfying((s) -> assertThat(Long.parseLong(s)).isPositive());
		assertThat(res.json().get("code").asString()).isEqualTo("rate_limited");
	}

	@Test
	void malformedEmailsAreRejectedWithFieldErrors() {
		var res = device().post("/api/auth/magic-link", "{\"email\":\"not-an-email\"}");
		assertThat(res.status()).isEqualTo(400);
		assertThat(res.json().get("errors").get(0).get("field").asString()).isEqualTo("email");
	}

	@Test
	void signingOutEndsTheSession() {
		var d = signedIn(uniqueEmail());
		var session = d.cookie("kl_session").orElseThrow();
		assertThat(d.post("/api/auth/logout", "").status()).isEqualTo(204);
		assertThat(d.get("/api/me").status()).isEqualTo(401);

		var replay = device();
		replay.forceSessionCookie(session);
		assertThat(replay.get("/api/me").status()).isEqualTo(401);
	}

	@Test
	void providersAreAdvertised() {
		var res = device().get("/api/auth/providers").json();
		assertThat(res.get("email").asBoolean()).isTrue();
		assertThat(res.get("github").asBoolean()).isFalse();
	}

}
