package dev.kubelearn.api.progress;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * A learner's progress. Designed to only ever grow, so any two copies merge without
 * conflicts — in any order, any number of times — and always agree:
 *
 * <ul>
 * <li>objectives: set union (once done, always done)</li>
 * <li>completedAt: earliest (when you <em>first</em> finished)</li>
 * <li>bestMs: smallest (personal best)</li>
 * <li>last: latest {@code at} wins (where to resume — the only last-writer-wins field)</li>
 * </ul>
 *
 * Mirrors packages/shared/src/progress.ts; both are checked against the same fixtures.
 */
public record Progress(SortedMap<String, LessonProgress> lessons, LastLesson last) {

	public Progress {
		lessons = Collections.unmodifiableSortedMap(new TreeMap<>(Objects.requireNonNull(lessons)));
	}

	public static Progress empty() {
		return new Progress(new TreeMap<>(), null);
	}

	public record LessonProgress(List<String> objectives, Instant completedAt, Integer bestMs) {

		public LessonProgress {
			objectives = List.copyOf(new TreeSet<>(objectives));
		}

		LessonProgress merge(LessonProgress other) {
			var union = new TreeSet<>(objectives);
			union.addAll(other.objectives);
			return new LessonProgress(List.copyOf(union), earliest(completedAt, other.completedAt),
					smallest(bestMs, other.bestMs));
		}

		public boolean completed() {
			return completedAt != null;
		}

	}

	public record LastLesson(String lessonId, Instant at) {
	}

	/** Commutative, associative and idempotent. */
	public Progress merge(Progress other) {
		var merged = new TreeMap<>(lessons);
		other.lessons.forEach((id, lp) -> merged.merge(id, lp, LessonProgress::merge));
		return new Progress(merged, laterOf(last, other.last));
	}

	private static LastLesson laterOf(LastLesson a, LastLesson b) {
		if (a == null) {
			return b;
		}
		if (b == null) {
			return a;
		}
		int byTime = a.at().compareTo(b.at());
		// ties broken by id so every replica picks the same winner
		return byTime > 0 || (byTime == 0 && a.lessonId().compareTo(b.lessonId()) >= 0) ? a : b;
	}

	private static Instant earliest(Instant a, Instant b) {
		if (a == null) {
			return b;
		}
		if (b == null) {
			return a;
		}
		return a.isBefore(b) ? a : b;
	}

	private static Integer smallest(Integer a, Integer b) {
		if (a == null) {
			return b;
		}
		if (b == null) {
			return a;
		}
		return Math.min(a, b);
	}

}
