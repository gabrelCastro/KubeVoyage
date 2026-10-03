package dev.kubelearn.api.account;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accounts are keyed by email: signing in with a link or with GitHub (using a verified
 * email) for the same address lands in the same account.
 */
@Repository
public class UserRepository {

	private static final String COLUMNS = "id, email, display_name, avatar_url, created_at";

	private final JdbcClient jdbc;

	UserRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public static String emailKey(String email) {
		return email.trim().toLowerCase(Locale.ROOT);
	}

	public Optional<AppUser> findById(UUID id) {
		return jdbc.sql("SELECT " + COLUMNS + " FROM app_user WHERE id = ?").param(id).query(UserRepository::map).optional();
	}

	/** Sign in with an email whose ownership was just proven (by a sign-in link). */
	@Transactional
	public AppUser signInWithEmail(String email) {
		var user = upsertByEmail(email.trim(), null, null);
		linkIdentity("email", emailKey(email), user.id());
		return user;
	}

	/** Sign in with GitHub. Links to an existing account by verified email. */
	@Transactional
	public AppUser signInWithGithub(String githubId, String verifiedEmail, String name, String avatarUrl) {
		var linked = jdbc.sql("""
				UPDATE app_user u
				SET last_login_at = now(),
				    display_name = coalesce(u.display_name, ?),
				    avatar_url = coalesce(?, u.avatar_url)
				FROM user_identity i
				WHERE i.provider = 'github' AND i.subject = ? AND i.user_id = u.id
				RETURNING u.id, u.email, u.display_name, u.avatar_url, u.created_at
				""").param(name).param(avatarUrl).param(githubId).query(UserRepository::map).optional();
		if (linked.isPresent()) {
			return linked.get();
		}
		var user = upsertByEmail(verifiedEmail, name, avatarUrl);
		linkIdentity("github", githubId, user.id());
		return user;
	}

	public record Identity(String provider, String subject, OffsetDateTime linkedAt) {
	}

	public record Activity(OffsetDateTime createdAt, OffsetDateTime lastLoginAt) {
	}

	/** Everything stored about how this account signs in, for the data export. */
	public List<Identity> identities(UUID userId) {
		return jdbc.sql("SELECT provider, subject, created_at FROM user_identity WHERE user_id = ? ORDER BY provider")
			.param(userId)
			.query((rs, i) -> new Identity(rs.getString(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class)))
			.list();
	}

	public Optional<Activity> activity(UUID userId) {
		return jdbc.sql("SELECT created_at, last_login_at FROM app_user WHERE id = ?")
			.param(userId)
			.query((rs, i) -> new Activity(rs.getObject(1, OffsetDateTime.class), rs.getObject(2, OffsetDateTime.class)))
			.optional();
	}

	public List<String> providers(UUID userId) {
		return jdbc.sql("SELECT provider FROM user_identity WHERE user_id = ? ORDER BY provider")
			.param(userId)
			.query(String.class)
			.list();
	}

	public boolean delete(UUID userId) {
		return jdbc.sql("DELETE FROM app_user WHERE id = ?").param(userId).update() == 1;
	}

	private AppUser upsertByEmail(String email, String name, String avatarUrl) {
		return jdbc.sql("""
				INSERT INTO app_user (email, email_key, display_name, avatar_url)
				VALUES (?, ?, ?, ?)
				ON CONFLICT (email_key) DO UPDATE
				SET last_login_at = now(),
				    display_name = coalesce(app_user.display_name, EXCLUDED.display_name),
				    avatar_url = coalesce(EXCLUDED.avatar_url, app_user.avatar_url)
				RETURNING id, email, display_name, avatar_url, created_at
				""").param(email).param(emailKey(email)).param(name).param(avatarUrl).query(UserRepository::map).single();
	}

	private void linkIdentity(String provider, String subject, UUID userId) {
		jdbc.sql("INSERT INTO user_identity (provider, subject, user_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
			.param(provider)
			.param(subject)
			.param(userId)
			.update();
	}

	private static AppUser map(ResultSet rs, int row) throws SQLException {
		return new AppUser(rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("display_name"),
				rs.getString("avatar_url"), rs.getObject("created_at", OffsetDateTime.class).toInstant());
	}

}
