package dev.kubelearn.api.progress;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import dev.kubelearn.api.progress.Progress.LastLesson;
import dev.kubelearn.api.progress.Progress.LessonProgress;

@Repository
public class ProgressRepository {

	private final JdbcClient jdbc;

	ProgressRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	@Transactional(readOnly = true)
	public Progress load(UUID userId) {
		var last = jdbc.sql("SELECT last_lesson_id, last_lesson_at FROM progress_meta WHERE user_id = ?")
			.param(userId)
			.query((rs, n) -> Optional.ofNullable(lastLesson(rs)))
			.optional()
			.flatMap((o) -> o)
			.orElse(null);
		return new Progress(lessons(userId), last);
	}

	/**
	 * Merge incoming progress into what's stored and return the result. Concurrent syncs
	 * for the same user are serialized on their progress_meta row, so none can lose the
	 * other's writes.
	 */
	@Transactional
	public Progress merge(UUID userId, Progress incoming) {
		jdbc.sql("INSERT INTO progress_meta (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING").param(userId).update();
		var last = jdbc.sql("SELECT last_lesson_id, last_lesson_at FROM progress_meta WHERE user_id = ? FOR UPDATE")
			.param(userId)
			.query((rs, n) -> Optional.ofNullable(lastLesson(rs)))
			.single()
			.orElse(null);

		var current = new Progress(lessons(userId), last);
		var merged = current.merge(incoming);

		merged.lessons().forEach((lessonId, lp) -> {
			if (!lp.equals(current.lessons().get(lessonId))) {
				upsert(userId, lessonId, lp);
			}
		});
		if (!Objects.equals(merged.last(), current.last())) {
			jdbc.sql("UPDATE progress_meta SET last_lesson_id = ?, last_lesson_at = ?, updated_at = now() WHERE user_id = ?")
				.param(merged.last().lessonId())
				.param(utc(merged.last().at()))
				.param(userId)
				.update();
		}
		return merged;
	}

	@Transactional
	public void reset(UUID userId) {
		jdbc.sql("DELETE FROM lesson_progress WHERE user_id = ?").param(userId).update();
		jdbc.sql("DELETE FROM progress_meta WHERE user_id = ?").param(userId).update();
	}

	private TreeMap<String, LessonProgress> lessons(UUID userId) {
		var out = new TreeMap<String, LessonProgress>();
		jdbc.sql("SELECT lesson_id, objectives, completed_at, best_ms FROM lesson_progress WHERE user_id = ?")
			.param(userId)
			.query((ResultSet rs) -> {
				out.put(rs.getString("lesson_id"), new LessonProgress(strings(rs.getArray("objectives")),
						instant(rs, "completed_at"), rs.getObject("best_ms", Integer.class)));
			});
		return out;
	}

	private void upsert(UUID userId, String lessonId, LessonProgress lp) {
		// merged values were computed under the row lock, so a plain overwrite is correct
		jdbc.sql("""
				INSERT INTO lesson_progress (user_id, lesson_id, objectives, completed_at, best_ms, updated_at)
				VALUES (?, ?, ?, ?, ?, now())
				ON CONFLICT (user_id, lesson_id) DO UPDATE
				SET objectives = EXCLUDED.objectives,
				    completed_at = EXCLUDED.completed_at,
				    best_ms = EXCLUDED.best_ms,
				    updated_at = now()
				""")
			.param(userId)
			.param(lessonId)
			.param(lp.objectives().toArray(String[]::new))
			.param(utc(lp.completedAt()))
			.param(lp.bestMs())
			.update();
	}

	private static LastLesson lastLesson(ResultSet rs) throws SQLException {
		var id = rs.getString("last_lesson_id");
		var at = instant(rs, "last_lesson_at");
		return id == null || at == null ? null : new LastLesson(id, at);
	}

	private static List<String> strings(Array array) throws SQLException {
		return array == null ? List.of() : List.of((String[]) array.getArray());
	}

	private static Instant instant(ResultSet rs, String column) throws SQLException {
		var t = rs.getObject(column, OffsetDateTime.class);
		return t == null ? null : t.toInstant();
	}

	private static OffsetDateTime utc(Instant instant) {
		return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
	}

}
