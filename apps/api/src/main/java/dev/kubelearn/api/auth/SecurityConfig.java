package dev.kubelearn.api.auth;

import java.io.IOException;
import java.util.List;

import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.DelegatingSecurityContextRepository;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy;

import dev.kubelearn.api.common.Problems;

/**
 * Cookie sessions for a same-origin SPA:
 * <ul>
 * <li>session cookie: httpOnly, SameSite=Lax, Secure in production, stored in Postgres</li>
 * <li>CSRF: double-submit cookie ({@code XSRF-TOKEN} → {@code X-XSRF-TOKEN}), required on every write
 * — including the sign-in endpoints themselves (no login CSRF)</li>
 * <li>signing in rotates the session id and the CSRF token</li>
 * <li>errors are JSON problems, never redirects or HTML</li>
 * </ul>
 */
@Configuration
class SecurityConfig {

	static final String SESSION_COOKIE = "kl_session";

	@Bean
	SecurityFilterChain api(HttpSecurity http, SecurityContextRepository contexts, CsrfTokenRepository csrf,
			JsonMapper json, ObjectProvider<ClientRegistrationRepository> github, ObjectProvider<GithubLogin> githubLogin)
			throws Exception {
		http.securityContext((c) -> c.securityContextRepository(contexts))
			.csrf((c) -> c.spa().csrfTokenRepository(csrf))
			.authorizeHttpRequests((a) -> a.requestMatchers("/api/auth/**", "/api/health/**", "/api/client-errors")
				.permitAll()
				.requestMatchers("/api/**")
				.authenticated()
				.anyRequest()
				.permitAll())
			.exceptionHandling((e) -> e.authenticationEntryPoint(unauthorized(json)).accessDeniedHandler(forbidden(json)))
			.logout((l) -> l.logoutUrl("/api/auth/logout")
				.logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler(HttpStatus.NO_CONTENT))
				.deleteCookies(SESSION_COOKIE))
			.headers((h) -> h.referrerPolicy((r) -> r.policy(ReferrerPolicy.NO_REFERRER))
				.permissionsPolicyHeader((p) -> p.policy("camera=(), microphone=(), geolocation=()")))
			.formLogin(AbstractHttpConfigurer::disable)
			.httpBasic(AbstractHttpConfigurer::disable)
			.requestCache((r) -> r.disable());

		if (github.getIfAvailable() != null) {
			githubLogin.getObject().configure(http);
		}
		return http.build();
	}

	@Bean
	SecurityContextRepository securityContextRepository() {
		return new DelegatingSecurityContextRepository(new RequestAttributeSecurityContextRepository(),
				new HttpSessionSecurityContextRepository());
	}

	@Bean
	CsrfTokenRepository csrfTokenRepository() {
		var repo = CookieCsrfTokenRepository.withHttpOnlyFalse();
		repo.setCookieCustomizer((c) -> c.sameSite("Lax").path("/"));
		return repo;
	}

	/** What happens on every successful sign-in: new session id, new CSRF token. */
	@Bean
	SessionAuthenticationStrategy signInStrategy(CsrfTokenRepository csrf) {
		return new CompositeSessionAuthenticationStrategy(
				List.of(new ChangeSessionIdAuthenticationStrategy(), new CsrfAuthenticationStrategy(csrf)));
	}

	private static AuthenticationEntryPoint unauthorized(JsonMapper json) {
		return (request, response, ex) -> write(json, response,
				Problems.of(HttpStatus.UNAUTHORIZED, "unauthenticated", "Entre para continuar."));
	}

	private static AccessDeniedHandler forbidden(JsonMapper json) {
		return (request, response, ex) -> write(json, response, ex instanceof CsrfException
				? Problems.of(HttpStatus.FORBIDDEN, "csrf", "Token CSRF ausente ou inválido. Recarregue a página e tente novamente.")
				: Problems.of(HttpStatus.FORBIDDEN, "forbidden", "Você não pode fazer isso."));
	}

	private static void write(JsonMapper json, HttpServletResponse response, ProblemDetail problem) throws IOException {
		response.setStatus(problem.getStatus());
		response.setContentType("application/problem+json");
		json.writeValue(response.getOutputStream(), problem);
	}

}
