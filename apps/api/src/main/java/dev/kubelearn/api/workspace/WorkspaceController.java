package dev.kubelearn.api.workspace;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.kubelearn.api.auth.SessionUser;
import dev.kubelearn.api.common.ApiException;
import dev.kubelearn.api.workspace.Workspace.Draft;
import dev.kubelearn.api.workspace.Workspace.Release;
import dev.kubelearn.api.workspace.WorkspacePayload.DraftPayload;
import dev.kubelearn.api.workspace.WorkspacePayload.ReleasePayload;

/**
 * "Your app", synced the same way as progress — every call is an idempotent merge — but in
 * small pieces, since code is bigger than progress: the draft on its own, and each published
 * image on its own (it never changes once published). The code is stored, never executed.
 */
@RestController
@RequestMapping("/api/workspace")
class WorkspaceController {

	private final WorkspaceRepository workspace;

	WorkspaceController(WorkspaceRepository workspace) {
		this.workspace = workspace;
	}

	@GetMapping
	Workspace get(@AuthenticationPrincipal SessionUser user) {
		return workspace.load(user.id());
	}

	@PutMapping("/draft")
	Draft draft(@AuthenticationPrincipal SessionUser user, @RequestBody @Validated DraftPayload payload) {
		var draft = payload.toDraft();
		// a device whose clock runs ahead must not win every future edit
		var now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		return workspace.mergeDraft(user.id(), new Draft(draft.design(), notAfter(draft.designAt(), now), draft.code(),
				notAfter(draft.codeAt(), now), draft.customized()));
	}

	@PutMapping("/releases/{tag}")
	Release release(@AuthenticationPrincipal SessionUser user, @PathVariable String tag, @RequestBody @Validated ReleasePayload payload) {
		if (!tag.equals(payload.tag())) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "A tag do caminho e a do corpo são diferentes.");
		}
		var release = payload.toRelease();
		if (release == null) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_tag", "Essa tag não pode ser publicada.");
		}
		var now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		var dated = new Release(release.tag(), release.design(), release.broken(), release.code(), notAfter(release.createdAt(), now));
		return workspace.addRelease(user.id(), dated)
			.orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "too_many_releases",
					"Sua conta já guarda o máximo de imagens publicadas."));
	}

	private static Instant notAfter(Instant t, Instant now) {
		if (t != null && t.isBefore(Instant.EPOCH)) {
			// every client must be able to read back what's stored (and none writes dates before 1970)
			throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "Data fora do intervalo aceito.");
		}
		return t == null || t.isBefore(now) ? t : now;
	}

}
