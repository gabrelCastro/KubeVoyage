package dev.kubelearn.api.workspace;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import dev.kubelearn.api.workspace.Workspace.Design;
import dev.kubelearn.api.workspace.Workspace.Draft;
import dev.kubelearn.api.workspace.Workspace.Release;

/**
 * Stores "your app". Every write merges under a lock on the user's app_workspace row, so
 * concurrent syncs from several devices can't lose each other's changes.
 */
@Repository
public class WorkspaceRepository {

	private final JdbcClient jdbc;

	WorkspaceRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	@Transactional(readOnly = true)
	public Workspace load(UUID userId) {
		var draft = jdbc.sql("SELECT * FROM app_workspace WHERE user_id = ?").param(userId).query((rs, n) -> draft(rs)).optional();
		return new Workspace(draft.orElse(Draft.EMPTY), releases(userId));
	}

	/** Merge an incoming draft into what's stored; returns the result. */
	@Transactional
	public Draft mergeDraft(UUID userId, Draft incoming) {
		var current = lock(userId);
		var merged = current.merge(incoming);
		if (!merged.equals(current)) {
			jdbc.sql("""
					UPDATE app_workspace
					SET name = ?, emoji = ?, color = ?, message = ?, design_at = ?, code = ?, code_at = ?, customized = ?, updated_at = now()
					WHERE user_id = ?
					""")
				.param(merged.design().name())
				.param(merged.design().emoji())
				.param(merged.design().color())
				.param(merged.design().message())
				.param(utc(merged.designAt()))
				.param(merged.code())
				.param(utc(merged.codeAt()))
				.param(merged.customized())
				.param(userId)
				.update();
		}
		return merged;
	}

	/**
	 * Add a published image. Returns what the tag holds afterwards — the incoming release, or
	 * an earlier one published with the same tag — or empty if the account is full of earlier ones.
	 */
	@Transactional
	public Optional<Release> addRelease(UUID userId, Release incoming) {
		lock(userId);
		var current = releases(userId);
		var merged = Workspace.mergeReleases(current, List.of(incoming));
		var kept = merged.stream().filter((r) -> r.tag().equals(incoming.tag())).findFirst();
		if (kept.isPresent() && kept.get().equals(incoming) && !current.contains(incoming)) {
			// it may take the place of one with the same tag (published later) or of the latest one (the cap)
			for (var old : current) {
				if (!merged.contains(old)) {
					jdbc.sql("DELETE FROM app_release WHERE user_id = ? AND tag = ?").param(userId).param(old.tag()).update();
				}
			}
			jdbc.sql("""
					INSERT INTO app_release (user_id, tag, name, emoji, color, message, broken, code, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					""")
				.param(userId)
				.param(incoming.tag())
				.param(incoming.design().name())
				.param(incoming.design().emoji())
				.param(incoming.design().color())
				.param(incoming.design().message())
				.param(incoming.broken())
				.param(incoming.code())
				.param(utc(incoming.createdAt()))
				.update();
		}
		return kept;
	}

	/** Creates the row if needed and locks it; returns the stored draft. */
	private Draft lock(UUID userId) {
		jdbc.sql("""
				INSERT INTO app_workspace (user_id, name, emoji, color, message) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (user_id) DO NOTHING
				""")
			.param(userId)
			.param(Design.DEFAULT.name())
			.param(Design.DEFAULT.emoji())
			.param(Design.DEFAULT.color())
			.param(Design.DEFAULT.message())
			.update();
		return jdbc.sql("SELECT * FROM app_workspace WHERE user_id = ? FOR UPDATE").param(userId).query((rs, n) -> draft(rs)).single();
	}

	private List<Release> releases(UUID userId) {
		var list = jdbc.sql("SELECT * FROM app_release WHERE user_id = ?")
			.param(userId)
			.query((rs, n) -> new Release(rs.getString("tag"), design(rs), rs.getBoolean("broken"), rs.getString("code"),
					instant(rs, "created_at")))
			.list();
		return Workspace.mergeReleases(List.of(), list);
	}

	private static Draft draft(ResultSet rs) throws SQLException {
		return new Draft(design(rs), instant(rs, "design_at"), rs.getString("code"), instant(rs, "code_at"), rs.getBoolean("customized"));
	}

	private static Design design(ResultSet rs) throws SQLException {
		return new Design(rs.getString("name"), rs.getString("emoji"), rs.getString("color"), rs.getString("message"));
	}

	private static Instant instant(ResultSet rs, String column) throws SQLException {
		var t = rs.getObject(column, OffsetDateTime.class);
		return t == null ? null : t.toInstant();
	}

	private static OffsetDateTime utc(Instant instant) {
		return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
	}

}
