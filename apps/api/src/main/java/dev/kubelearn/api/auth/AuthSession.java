package dev.kubelearn.api.auth;

import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.stereotype.Component;

/**
 * Establishes a signed-in session for an account — the single place every sign-in
 * method (link or GitHub) ends up. Rotates the session id (no session fixation) and the
 * CSRF token, then stores the security context in the (JDBC-backed) session.
 */
@Component
public class AuthSession {

	private final SecurityContextRepository contexts;

	private final SessionAuthenticationStrategy onSignIn;

	private final SecurityContextHolderStrategy holder = SecurityContextHolder.getContextHolderStrategy();

	AuthSession(SecurityContextRepository contexts, SessionAuthenticationStrategy onSignIn) {
		this.contexts = contexts;
		this.onSignIn = onSignIn;
	}

	public Authentication signIn(UUID userId, HttpServletRequest request, HttpServletResponse response) {
		Authentication auth = UsernamePasswordAuthenticationToken.authenticated(new SessionUser(userId), null,
				AuthorityUtils.createAuthorityList("ROLE_USER"));
		onSignIn.onAuthentication(auth, request, response);
		var context = holder.createEmptyContext();
		context.setAuthentication(auth);
		holder.setContext(context);
		contexts.saveContext(context, request, response);
		// the strategy rotated the CSRF token lazily; resolve it now so this very response
		// carries the new XSRF-TOKEN cookie and the client's next write just works
		if (request.getAttribute(CsrfToken.class.getName()) instanceof CsrfToken csrf) {
			csrf.getToken();
		}
		return auth;
	}

}
