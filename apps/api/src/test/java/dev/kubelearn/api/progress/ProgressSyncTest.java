package dev.kubelearn.api.progress;

import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

import dev.kubelearn.api.support.ApiTest;

import static org.assertj.core.api.Assertions.assertThat;

class ProgressSyncTest extends ApiTest {

	private static String lesson(String id, String objectives, String completedAt, Integer bestMs) {
		return "\"%s\":{\"objectives\":[%s],\"completedAt\":%s,\"bestMs\":%s}".formatted(id, objectives,
				completedAt == null ? "null" : "\"" + completedAt + "\"", bestMs);
	}

	@Test
	void anAccountStartsEmpty() {
		var res = signedIn(uniqueEmail()).get("/api/progress").json();
		assertThat(res.get("lessons").size()).isZero();
		assertThat(res.get("last").isNull()).isTrue();
	}

	@Test
	void syncStoresWhatItKnowsAndDropsWhatItDoesnt() {
		var d = signedIn(uniqueEmail());
		var res = d.put("/api/progress", "{\"lessons\":{" + lesson("scaling", "\"drag\",\"bogus\",\"drag\"", null, null) + ","
				+ lesson("retired-lesson", "\"x\"", null, null) + "},\"last\":{\"lessonId\":\"scaling\",\"at\":\"2026-10-03T02:00:00Z\"}}");

		assertThat(res.status()).isEqualTo(200);
		var lessons = res.json().get("lessons");
		assertThat(lessons.propertyNames()).containsExactly("scaling");
		assertThat(lessons.get("scaling").get("objectives").get(0).asString()).isEqualTo("drag");
		assertThat(lessons.get("scaling").get("objectives").size()).isEqualTo(1);
		assertThat(d.get("/api/progress").body()).isEqualTo(res.body());
	}

	@Test
	void twoDevicesEndUpWithTheUnion() {
		var email = uniqueEmail();
		var laptop = signedIn(email);
		var phone = signedIn(email);

		laptop.put("/api/progress", "{\"lessons\":{" + lesson("scaling", "\"drag\"", "2026-10-02T10:00:00Z", 60000) + "},\"last\":{\"lessonId\":\"scaling\",\"at\":\"2026-10-02T10:00:00Z\"}}");
		var merged = phone.put("/api/progress", "{\"lessons\":{" + lesson("scaling", "\"command\"", "2026-10-02T12:00:00Z", 30000) + ","
				+ lesson("labels", "\"inspect\"", null, null) + "},\"last\":{\"lessonId\":\"labels\",\"at\":\"2026-10-02T12:00:00Z\"}}").json();

		var scaling = merged.get("lessons").get("scaling");
		assertThat(scaling.get("objectives").toString()).isEqualTo("[\"command\",\"drag\"]");
		assertThat(scaling.get("completedAt").asString()).isEqualTo("2026-10-02T10:00:00Z"); // first completion
		assertThat(scaling.get("bestMs").asInt()).isEqualTo(30000); // personal best
		assertThat(merged.get("last").get("lessonId").asString()).isEqualTo("labels"); // most recent
		assertThat(laptop.get("/api/progress").body()).isEqualTo(phone.get("/api/progress").body());
	}

	@Test
	void syncingIsIdempotent() {
		var d = signedIn(uniqueEmail());
		var body = "{\"lessons\":{" + lesson("debugging", "\"notice\",\"fix\"", "2026-10-01T00:00:00Z", 1234) + "},\"last\":null}";
		var first = d.put("/api/progress", body).body();
		for (int i = 0; i < 3; i++) {
			assertThat(d.put("/api/progress", body).body()).isEqualTo(first);
		}
	}

	@Test
	void concurrentSyncsFromManyDevicesLoseNothing() throws Exception {
		var email = uniqueEmail();
		// three devices (the per-address link limit), each writing two different objectives
		var devices = IntStream.range(0, 3).mapToObj((i) -> signedIn(email)).toList();
		var objectives = new String[][] { { "apply", "get" }, { "delete", "heal" }, { "chaos", "apply" } };

		var jobs = new ArrayList<Callable<Integer>>();
		for (int i = 0; i < devices.size(); i++) {
			var d = devices.get(i);
			for (int round = 0; round < 10; round++) {
				var o = objectives[i][round % 2];
				jobs.add(() -> d.put("/api/progress", "{\"lessons\":{" + lesson("self-healing", "\"" + o + "\"", null, null) + "},\"last\":null}").status());
			}
		}
		try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
			for (var f : pool.invokeAll(jobs)) {
				assertThat(f.get()).isEqualTo(200);
			}
		}
		var stored = devices.getFirst().get("/api/progress").json().get("lessons").get("self-healing").get("objectives").toString();
		assertThat(stored).isEqualTo("[\"apply\",\"chaos\",\"delete\",\"get\",\"heal\"]");
	}

	@Test
	void malformedPayloadsAreRejectedWithReasons() {
		var d = signedIn(uniqueEmail());
		var negative = d.put("/api/progress", "{\"lessons\":{" + lesson("scaling", "", "2026-10-01T00:00:00Z", -5) + "},\"last\":null}");
		assertThat(negative.status()).isEqualTo(400);
		assertThat(negative.json().get("code").asString()).isEqualTo("invalid_request");

		assertThat(d.put("/api/progress", "{\"lessons\":\"nope\"}").status()).isEqualTo(400);
		assertThat(d.put("/api/progress", "not json").status()).isEqualTo(400);
		assertThat(d.put("/api/progress", "{\"last\":null}").status()).isEqualTo(400);
		assertThat(d.put("/api/progress", "{\"lessons\":{},\"last\":{\"lessonId\":\"scaling\",\"at\":\"yesterday\"}}").status()).isEqualTo(400);
	}

	@Test
	void hugePayloadsAreRefusedBeforeParsing() {
		var d = signedIn(uniqueEmail());
		var res = d.put("/api/progress", "{\"pad\":\"" + "x".repeat(70_000) + "\",\"lessons\":{},\"last\":null}");
		assertThat(res.status()).isEqualTo(413);
	}

	@Test
	void resetErasesProgressButKeepsTheAccount() {
		var d = signedIn(uniqueEmail());
		d.put("/api/progress", "{\"lessons\":{" + lesson("failures", "\"ship\"", null, null) + "},\"last\":{\"lessonId\":\"failures\",\"at\":\"2026-10-01T00:00:00Z\"}}");
		assertThat(d.delete("/api/progress").status()).isEqualTo(204);
		var after = d.get("/api/progress").json();
		assertThat(after.get("lessons").size()).isZero();
		assertThat(after.get("last").isNull()).isTrue();
		assertThat(d.get("/api/me").status()).isEqualTo(200);
	}

	@Test
	void progressIsPrivateToItsAccount() {
		var alice = signedIn(uniqueEmail());
		var bob = signedIn(uniqueEmail());
		alice.put("/api/progress", "{\"lessons\":{" + lesson("services", "\"expose\"", null, null) + "},\"last\":null}");
		assertThat(bob.get("/api/progress").json().get("lessons").size()).isZero();
	}

}
