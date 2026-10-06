package dev.kubelearn.api.account;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
import dev.kubelearn.api.progress.Progress;
import dev.kubelearn.api.progress.ProgressRepository;
import dev.kubelearn.api.workspace.Workspace;
import dev.kubelearn.api.workspace.WorkspaceRepository;

@RestController
@RequestMapping("/api/me")
public class AccountController {

	public record Me(UUID id, String email, String name, String avatarUrl, List<String> providers, Instant createdAt) {
	}

	/** Everything the service stores about one person (LGPD art. 18: access and portability). */
	public record Export(Instant exportedAt, Me account, UserRepository.Activity activity, List<UserRepository.Identity> identities, Progress progress,
			Workspace workspace) {
	}

	private final UserRepository users;

	private final ProgressRepository progress;

	private final WorkspaceRepository workspace;

	private final FindByIndexNameSessionRepository<? extends Session> sessions;

	AccountController(UserRepository users, ProgressRepository progress, WorkspaceRepository workspace,
			FindByIndexNameSessionRepository<? extends Session> sessions) {
		this.users = users;
		this.progress = progress;
		this.workspace = workspace;
		this.sessions = sessions;
	}

	@GetMapping
	Me me(@AuthenticationPrincipal SessionUser user) {
		return users.findById(user.id())
			.map(this::describe)
			.orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "account_gone", "Esta conta não existe mais."));
	}

	@GetMapping("/export")
	ResponseEntity<Export> export(@AuthenticationPrincipal SessionUser user) {
		var me = me(user);
		var activity = users.activity(user.id()).orElseThrow();
		var body = new Export(Instant.now(), me, activity, users.identities(user.id()), progress.load(user.id()),
				workspace.load(user.id()));
		var file = ContentDisposition.attachment().filename("kubelearn-meus-dados.json").build();
		return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, file.toString()).body(body);
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
