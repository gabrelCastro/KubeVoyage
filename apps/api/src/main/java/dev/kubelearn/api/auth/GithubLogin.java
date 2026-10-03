package dev.kubelearn.api.auth;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.boot.autoconfigure.condition.ConditionOutcome;
import org.springframework.boot.autoconfigure.condition.SpringBootCondition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.http.HttpHeaders;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.client.RestClient;

import dev.kubelearn.api.KubelearnProperties;
import dev.kubelearn.api.account.UserRepository;

/**
 * "Sign in with GitHub" — only wired when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set.
 *
 * Accounts are linked by GitHub's <em>verified</em> email only. GitHub's access token is
 * used once to read the profile and emails, then dropped: nothing about it is stored.
 */
@Configuration(proxyBeanMethods = false)
@Conditional(GithubLogin.Enabled.class)
public class GithubLogin {

	static class Enabled extends SpringBootCondition {

		@Override
		public ConditionOutcome getMatchOutcome(ConditionContext context, AnnotatedTypeMetadata metadata) {
			var env = context.getEnvironment();
			boolean on = !env.getProperty("kubelearn.github.client-id", "").isBlank()
					&& !env.getProperty("kubelearn.github.client-secret", "").isBlank();
			return new ConditionOutcome(on, on ? "GitHub sign-in configured" : "kubelearn.github.client-id/secret not set");
		}

	}

	private final KubelearnProperties props;

	private final AuthSession session;

	private final GithubUserService users;

	GithubLogin(KubelearnProperties props, AuthSession session, UserRepository accounts) {
		this.props = props;
		this.session = session;
		this.users = new GithubUserService(new DefaultOAuth2UserService(),
				RestClient.builder().baseUrl("https://api.github.com").build(), accounts);
	}

	@Bean
	ClientRegistrationRepository clientRegistrationRepository() {
		return new InMemoryClientRegistrationRepository(CommonOAuth2Provider.GITHUB.getBuilder("github")
			.clientId(props.github().clientId())
			.clientSecret(props.github().clientSecret())
			.scope("read:user", "user:email")
			.build());
	}

	void configure(HttpSecurity http) throws Exception {
		http.oauth2Login((o) -> o.loginPage("/")
			.userInfoEndpoint((u) -> u.userService(users))
			.authorizedClientRepository(new Discard())
			.successHandler(this::onSuccess)
			.failureHandler((req, res, ex) -> {
				var code = ex instanceof OAuth2AuthenticationException o2 ? o2.getError().getErrorCode() : "github_failed";
				res.sendRedirect(props.url("/?auth-error=" + code.replaceAll("[^a-z_]", "")));
			}));
	}

	private void onSuccess(HttpServletRequest request, HttpServletResponse response, Authentication auth)
			throws IOException {
		var principal = (OAuth2User) auth.getPrincipal();
		// swap GitHub's principal for ours, so every session looks the same whatever the sign-in method
		session.signIn((UUID) principal.getAttributes().get(GithubUserService.APP_USER_ID), request, response);
		response.sendRedirect(props.url("/?signed-in=github"));
	}

	/** We only need GitHub to tell us who someone is, not to act on their behalf later. */
	static final class Discard implements OAuth2AuthorizedClientRepository {

		@Override
		public <T extends OAuth2AuthorizedClient> T loadAuthorizedClient(String id, Authentication p, HttpServletRequest r) {
			return null;
		}

		@Override
		public void saveAuthorizedClient(OAuth2AuthorizedClient c, Authentication p, HttpServletRequest r,
				HttpServletResponse s) {
		}

		@Override
		public void removeAuthorizedClient(String id, Authentication p, HttpServletRequest r, HttpServletResponse s) {
		}

	}

	/** Loads the GitHub profile, finds a verified email, and signs in (or up) the matching account. */
	public static class GithubUserService implements OAuth2UserService<OAuth2UserRequest, OAuth2User> {

		static final String APP_USER_ID = "kubelearn_user_id";

		record GithubEmail(String email, boolean primary, boolean verified) {
		}

		private final OAuth2UserService<OAuth2UserRequest, OAuth2User> profiles;

		private final RestClient github;

		private final UserRepository accounts;

		public GithubUserService(OAuth2UserService<OAuth2UserRequest, OAuth2User> profiles, RestClient github,
				UserRepository accounts) {
			this.profiles = profiles;
			this.github = github;
			this.accounts = accounts;
		}

		@Override
		public OAuth2User loadUser(OAuth2UserRequest request) {
			var profile = profiles.loadUser(request);
			Map<String, Object> attrs = profile.getAttributes();
			var githubId = String.valueOf(attrs.get("id"));
			var email = verifiedEmail(request.getAccessToken().getTokenValue())
				.orElseThrow(() -> new OAuth2AuthenticationException(new OAuth2Error("no_verified_email",
						"Your GitHub account has no verified email address.", null)));
			var name = Optional.ofNullable((String) attrs.get("name")).orElse((String) attrs.get("login"));
			var user = accounts.signInWithGithub(githubId, email, name, (String) attrs.get("avatar_url"));

			var withId = new HashMap<>(attrs);
			withId.put(APP_USER_ID, user.id());
			return new DefaultOAuth2User(profile.getAuthorities(), withId, "id");
		}

		Optional<String> verifiedEmail(String accessToken) {
			List<GithubEmail> emails = github.get()
				.uri("/user/emails")
				.header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
				.header(HttpHeaders.ACCEPT, "application/vnd.github+json")
				.retrieve()
				.body(new ParameterizedTypeReference<>() {
				});
			if (emails == null) {
				return Optional.empty();
			}
			return emails.stream()
				.filter(GithubEmail::verified)
				.sorted((a, b) -> Boolean.compare(b.primary(), a.primary()))
				.map(GithubEmail::email)
				.findFirst();
		}

	}

}
