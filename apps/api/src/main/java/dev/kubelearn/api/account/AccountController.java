package dev.kubelearn.api.account;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.CookieClearingLogoutHandler;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import dev.kubelearn.api.auth.SessionUser;
import dev.kubelearn.api.common.ApiException;

@RestController
@RequestMapping("/api/me")
public class AccountController {

	public record Me(UUID id, String email, String name, String avatarUrl, List<String> providers, Instant createdAt) {
	}

	private final UserRepository users;

	private final FindByIndexNameSessionRepository<? extends Session> sessions;

	AccountController(UserRepository users, FindByIndexNameSessionRepository<? extends Session> sessions) {
		this.users = users;
		this.sessions = sessions;
	}

	@GetMapping
	Me me(@AuthenticationPrincipal SessionUser user) {
		return users.findById(user.id())
			.map(this::describe)
			.orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "account_gone", "Esta conta não existe mais."));
	}

	/** Deletes the account and everything in it, and signs it out everywhere. */
	@DeleteMapping
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@AuthenticationPrincipal SessionUser user, HttpServletRequest request, HttpServletResponse response) {
		users.delete(user.id());
		sessions.findByPrincipalName(user.getName()).keySet().forEach(sessions::deleteById);
		var current = request.getSession(false);
		if (current != null) {
			current.invalidate();
		}
		SecurityContextHolder.clearContext();
		new CookieClearingLogoutHandler("kl_session").logout(request, response, null);
	}

	public Me describe(AppUser u) {
		return new Me(u.id(), u.email(), u.displayName(), u.avatarUrl(), users.providers(u.id()), u.createdAt());
	}

}
