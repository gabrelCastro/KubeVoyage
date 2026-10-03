package dev.kubelearn.api.progress;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import dev.kubelearn.api.auth.SessionUser;

/**
 * Sync is a single idempotent call: the client sends everything it has, the server
 * merges it with everything it has, and both end up with the union.
 */
@RestController
@RequestMapping("/api/progress")
class ProgressController {

	private final ProgressRepository progress;

	private final LessonCatalog catalog;

	ProgressController(ProgressRepository progress, LessonCatalog catalog) {
		this.progress = progress;
		this.catalog = catalog;
	}

	@GetMapping
	Progress get(@AuthenticationPrincipal SessionUser user) {
		return progress.load(user.id());
	}

	@PutMapping
	Progress sync(@AuthenticationPrincipal SessionUser user, @RequestBody @Validated ProgressPayload payload) {
		return progress.merge(user.id(), payload.toProgress(catalog));
	}

	@DeleteMapping
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void reset(@AuthenticationPrincipal SessionUser user) {
		progress.reset(user.id());
	}

}
