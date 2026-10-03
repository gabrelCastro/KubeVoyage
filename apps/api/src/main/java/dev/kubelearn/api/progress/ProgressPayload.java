package dev.kubelearn.api.progress;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import dev.kubelearn.api.progress.Progress.LastLesson;
import dev.kubelearn.api.progress.Progress.LessonProgress;

/**
 * Progress as it arrives over the wire: shape-checked by Bean Validation, then
 * {@linkplain #toProgress(LessonCatalog) sanitized} into canonical {@link Progress}.
 */
public record ProgressPayload(
		@NotNull @Size(max = 64) Map<@NotBlank @Size(max = 40) String, @NotNull @Valid LessonPayload> lessons,
		@Valid LastPayload last) {

	public record LessonPayload(
			@NotNull @Size(max = 32) List<@NotBlank @Size(max = 40) String> objectives,
			OffsetDateTime completedAt,
			@Positive @Max(24 * 60 * 60 * 1000) Integer bestMs) {
	}

	public record LastPayload(@NotBlank @Size(max = 40) String lessonId, @NotNull OffsetDateTime at) {
	}

	/**
	 * Drop what this version doesn't know (unknown lessons or objectives) and normalize
	 * the rest: sorted, de-duplicated, UTC, millisecond precision. Never fails on valid input.
	 */
	public Progress toProgress(LessonCatalog catalog) {
		var out = new TreeMap<String, LessonProgress>();
		lessons.forEach((id, lp) -> {
			if (!catalog.isLesson(id)) {
				return;
			}
			var objectives = lp.objectives().stream().filter((o) -> catalog.isObjective(id, o)).toList();
			Instant completedAt = millis(lp.completedAt());
			// a best time only means something for a finished lesson
			Integer bestMs = completedAt != null ? lp.bestMs() : null;
			if (objectives.isEmpty() && completedAt == null) {
				return;
			}
			out.put(id, new LessonProgress(objectives, completedAt, bestMs));
		});
		LastLesson resume = (last != null && catalog.isLesson(last.lessonId()))
				? new LastLesson(last.lessonId(), millis(last.at())) : null;
		return new Progress(out, resume);
	}

	private static Instant millis(OffsetDateTime t) {
		return t == null ? null : t.toInstant().truncatedTo(ChronoUnit.MILLIS);
	}

}
