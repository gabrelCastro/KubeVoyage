package dev.kubelearn.api.workspace;

import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.Test;

import dev.kubelearn.api.support.ApiTest;

import static org.assertj.core.api.Assertions.assertThat;

class WorkspaceSyncTest extends ApiTest {

	private static final String DESIGN = "{\"name\":\"Raposa\",\"emoji\":\"🦊\",\"color\":\"laranja\",\"message\":\"v2!\"}";

	private static String draft(String designAt, String code, String codeAt) {
		return "{\"design\":%s,\"designAt\":%s,\"code\":%s,\"codeAt\":%s,\"customized\":true}".formatted(DESIGN, quoted(designAt), quoted(code), quoted(codeAt));
	}

	private static String release(String tag, String code, String createdAt) {
		return "{\"tag\":\"%s\",\"design\":%s,\"broken\":false,\"code\":%s,\"createdAt\":\"%s\"}".formatted(tag, DESIGN, quoted(code), createdAt);
	}

	private static String quoted(String s) {
		return s == null ? "null" : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
	}

	@Test
	void anAccountStartsWithTheDefaultApp() {
		var res = signedIn(uniqueEmail()).get("/api/workspace").json();
		assertThat(res.get("draft").get("design").get("name").asString()).isEqualTo("Meu app");
		assertThat(res.get("draft").get("code").isNull()).isTrue();
		assertThat(res.get("releases").size()).isZero();
	}

	@Test
	void theNewestDraftWinsPerFieldAcrossDevices() {
		var email = uniqueEmail();
		var laptop = signedIn(email);
		var phone = signedIn(email);
		laptop.put("/api/workspace/draft", draft("2026-01-01T00:00:00Z", "console.log('notebook')", "2026-01-03T00:00:00Z"));
		var merged = phone.put("/api/workspace/draft", draft("2026-01-02T00:00:00Z", "console.log('celular')", "2026-01-02T00:00:00Z")).json();
		assertThat(merged.get("code").asString()).isEqualTo("console.log('notebook')");
		assertThat(merged.get("designAt").asString()).isEqualTo("2026-01-02T00:00:00Z");
		assertThat(laptop.get("/api/workspace").json().get("draft")).isEqualTo(merged);
	}

	@Test
	void aClockAheadOfTheServerCantWinForever() {
		var d = signedIn(uniqueEmail());
		var res = d.put("/api/workspace/draft", draft("2999-01-01T00:00:00Z", "x", "2999-01-01T00:00:00Z")).json();
		assertThat(res.get("codeAt").asString()).doesNotStartWith("2999");
	}

	@Test
	void aPublishedTagNeverChanges() {
		var email = uniqueEmail();
		var first = signedIn(email);
		var second = signedIn(email);
		var a = first.put("/api/workspace/releases/2.0", release("2.0", "console.log('primeiro')", "2026-01-01T00:00:00Z"));
		assertThat(a.status()).isEqualTo(200);
		// same tag, published later elsewhere: the server answers with the image that already has it
		var b = second.put("/api/workspace/releases/2.0", release("2.0", "console.log('depois')", "2026-01-02T00:00:00Z")).json();
		assertThat(b.get("code").asString()).isEqualTo("console.log('primeiro')");
		// retrying is harmless
		assertThat(first.put("/api/workspace/releases/2.0", release("2.0", "console.log('primeiro')", "2026-01-01T00:00:00Z")).body()).isEqualTo(a.body());
		assertThat(second.get("/api/workspace").json().get("releases").size()).isEqualTo(1);
	}

	@Test
	void anEarlierImageWithTheSameTagReplacesTheStoredOne() {
		var d = signedIn(uniqueEmail());
		d.put("/api/workspace/releases/2.0", release("2.0", "console.log('depois')", "2026-01-02T00:00:00Z"));
		// another device had published 2.0 first: its image is the one the tag holds
		var res = d.put("/api/workspace/releases/2.0", release("2.0", "console.log('antes')", "2026-01-01T00:00:00Z")).json();
		assertThat(res.get("code").asString()).isEqualTo("console.log('antes')");
		var stored = d.get("/api/workspace").json().get("releases");
		assertThat(stored.size()).isEqualTo(1);
		assertThat(stored.get(0).get("code").asString()).isEqualTo("console.log('antes')");
	}

	@Test
	void datesNoClientCouldReadBackAreRejected() {
		var d = signedIn(uniqueEmail());
		assertThat(d.put("/api/workspace/releases/2.0", release("2.0", null, "0000-01-01T00:00:00+01:00")).status()).isEqualTo(400);
		assertThat(d.put("/api/workspace/draft", draft("1969-12-31T23:59:59Z", null, null)).status()).isEqualTo(400);
		assertThat(d.get("/api/workspace").json().get("releases").size()).isZero();
	}

	@Test
	void lessonTagsAndMismatchesAreRejected() {
		var d = signedIn(uniqueEmail());
		var reserved = d.put("/api/workspace/releases/1.4", release("1.4", null, "2026-01-01T00:00:00Z"));
		assertThat(reserved.status()).isEqualTo(400);
		assertThat(reserved.json().get("code").asString()).isEqualTo("invalid_tag");
		assertThat(d.put("/api/workspace/releases/2.0", release("2.1", null, "2026-01-01T00:00:00Z")).status()).isEqualTo(400);
		assertThat(d.put("/api/workspace/draft", "{\"design\":null}").status()).isEqualTo(400);
		assertThat(d.put("/api/workspace/draft", draft(null, "x".repeat(16_001), null)).status()).isEqualTo(400);
	}

	@Test
	void theAccountKeepsAtMostTheEarliestImages() {
		var d = signedIn(uniqueEmail());
		for (int i = 0; i < 20; i++) {
			assertThat(d.put("/api/workspace/releases/t" + i, release("t" + i, null, "2026-01-01T00:%02d:00Z".formatted(i + 1))).status()).isEqualTo(200);
		}
		var late = d.put("/api/workspace/releases/tarde", release("tarde", null, "2026-02-01T00:00:00Z"));
		assertThat(late.status()).isEqualTo(409);
		assertThat(late.json().get("code").asString()).isEqualTo("too_many_releases");
		// an earlier one takes the latest one's place, as merging two devices' lists would
		assertThat(d.put("/api/workspace/releases/cedo", release("cedo", null, "2026-01-01T00:00:00Z")).status()).isEqualTo(200);
		var tags = d.get("/api/workspace").json().get("releases").valueStream().map((r) -> r.get("tag").asString()).toList();
		assertThat(tags).hasSize(20).startsWith("cedo").doesNotContain("t19");
	}

	@Test
	void concurrentPublishesFromManyDevicesLoseNothing() throws Exception {
		var email = uniqueEmail();
		var devices = java.util.stream.IntStream.range(0, 3).mapToObj((i) -> signedIn(email)).toList();
		var jobs = new ArrayList<Callable<Integer>>();
		for (int i = 0; i < 12; i++) {
			var d = devices.get(i % 3);
			var tag = "v" + i;
			jobs.add(() -> d.put("/api/workspace/releases/" + tag, release(tag, "console.log(" + tag.length() + ")", "2026-01-01T00:00:00Z")).status());
		}
		try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
			for (var f : pool.invokeAll(jobs)) {
				assertThat(f.get()).isEqualTo(200);
			}
		}
		assertThat(devices.getFirst().get("/api/workspace").json().get("releases").size()).isEqualTo(12);
	}

	@Test
	void theExportAndAccountDeletionIncludeTheApp() {
		var email = uniqueEmail();
		var d = signedIn(email);
		d.put("/api/workspace/draft", draft("2026-01-01T00:00:00Z", "console.log('meu')", "2026-01-01T00:00:00Z"));
		d.put("/api/workspace/releases/2.0", release("2.0", "console.log('meu')", "2026-01-01T00:00:00Z"));
		var export = d.get("/api/me/export").json().get("workspace");
		assertThat(export.get("draft").get("code").asString()).isEqualTo("console.log('meu')");
		assertThat(export.get("releases").get(0).get("tag").asString()).isEqualTo("2.0");

		d.delete("/api/me");
		var fresh = signedIn(email).get("/api/workspace").json();
		assertThat(fresh.get("draft").get("code").isNull()).isTrue();
		assertThat(fresh.get("releases").size()).isZero();
	}

	@Test
	void theAppNeedsASignedInAccount() {
		assertThat(device().get("/api/workspace").status()).isEqualTo(401);
	}

}
