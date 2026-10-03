package dev.kubelearn.api.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import dev.kubelearn.api.KubelearnProperties;
import dev.kubelearn.api.account.AccountController.Me;
import dev.kubelearn.api.account.AccountController;
import dev.kubelearn.api.account.UserRepository;
import dev.kubelearn.api.common.ApiException;
import dev.kubelearn.api.common.RateLimiter;

/**
 * Passwordless sign-in. The link in the email opens the web app, which asks the person to
 * confirm before spending the token — so mail scanners that pre-open links can't burn it.
 */
@RestController
@RequestMapping("/api/auth/magic-link")
class MagicLinkController {

	record LinkRequest(@NotBlank @Email(regexp = ".+@.+\\..+") @Size(max = 254) String email) {
	}

	record LinkSent(String email, long expiresInSeconds) {
	}

	record VerifyRequest(@NotBlank @Size(max = 128) @Pattern(regexp = "[A-Za-z0-9_-]+") String token) {
	}

	private final MagicLinkTokens tokens;

	private final MagicLinkMailer mailer;

	private final UserRepository users;

	private final AuthSession session;

	private final AccountController accounts;

	private final RateLimiter limiter;

	private final KubelearnProperties props;

	MagicLinkController(MagicLinkTokens tokens, MagicLinkMailer mailer, UserRepository users, AuthSession session,
			AccountController accounts, RateLimiter limiter, KubelearnProperties props) {
		this.tokens = tokens;
		this.mailer = mailer;
		this.users = users;
		this.session = session;
		this.accounts = accounts;
		this.limiter = limiter;
		this.props = props;
	}

	/** Always 202 for a well-formed address: whether an account exists is never revealed. */
	@PostMapping
	@ResponseStatus(HttpStatus.ACCEPTED)
	LinkSent request(@RequestBody @Validated LinkRequest body, HttpServletRequest http) {
		var limits = props.limits();
		var email = body.email().trim();
		limiter.hit("link:ip:" + http.getRemoteAddr(), limits.linksPerIp(), limits.linksPerIpWindow());
		limiter.hit("link:email:" + UserRepository.emailKey(email), limits.linksPerEmail(), limits.linksPerEmailWindow());

		var ttl = props.magicLinkTtl();
		var token = tokens.issue(email, ttl);
		// the token rides in the fragment: never sent to any server, never in logs or Referer headers
		mailer.send(email, props.url("/auth/verify#token=" + token), ttl);
		return new LinkSent(email, ttl.toSeconds());
	}

	@PostMapping("/verify")
	Me verify(@RequestBody @Validated VerifyRequest body, HttpServletRequest http, HttpServletResponse response) {
		var limits = props.limits();
		limiter.hit("verify:ip:" + http.getRemoteAddr(), limits.verifiesPerIp(), limits.verifiesPerIpWindow());

		var email = tokens.consume(body.token())
			.orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "invalid_link",
					"Este link de acesso é inválido, expirou ou já foi usado."));
		var user = users.signInWithEmail(email);
		session.signIn(user.id(), http, response);
		return accounts.describe(user);
	}

}
