package dev.kubelearn.api.account;

import org.junit.jupiter.api.Test;

import dev.kubelearn.api.support.ApiTest;

import static org.assertj.core.api.Assertions.assertThat;

class AccountTest extends ApiTest {

	@Test
	void deletingTheAccountErasesItsDataAndSignsOutEveryDevice() {
		var email = uniqueEmail();
		var laptop = signedIn(email);
		var phone = signedIn(email);
		laptop.put("/api/progress", "{\"lessons\":{\"scaling\":{\"objectives\":[\"drag\"],\"completedAt\":null,\"bestMs\":null}},\"last\":null}");
		var id = laptop.get("/api/me").json().get("id").asString();

		assertThat(laptop.delete("/api/me").status()).isEqualTo(204);

		assertThat(laptop.get("/api/me").status()).isEqualTo(401);
		assertThat(phone.get("/api/me").status()).isEqualTo(401);
		for (var table : new String[] { "app_user WHERE id", "user_identity WHERE user_id", "lesson_progress WHERE user_id", "progress_meta WHERE user_id" }) {
			var n = db.sql("SELECT count(*) FROM " + table + " = ?::uuid").param(id).query(Long.class).single();
			assertThat(n).as(table).isZero();
		}
		var sessions = db.sql("SELECT count(*) FROM spring_session WHERE principal_name = ?").param(id).query(Long.class).single();
		assertThat(sessions).isZero();
	}

	@Test
	void signingUpAgainAfterDeletingStartsFresh() {
		var email = uniqueEmail();
		var d = signedIn(email);
		d.put("/api/progress", "{\"lessons\":{\"labels\":{\"objectives\":[\"inspect\"],\"completedAt\":null,\"bestMs\":null}},\"last\":null}");
		var oldId = d.get("/api/me").json().get("id").asString();
		d.delete("/api/me");

		var fresh = signedIn(email);
		assertThat(fresh.get("/api/me").json().get("id").asString()).isNotEqualTo(oldId);
		assertThat(fresh.get("/api/progress").json().get("lessons").size()).isZero();
	}

}
