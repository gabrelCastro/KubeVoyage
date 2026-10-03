package dev.kubelearn.api.ops;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import dev.kubelearn.api.support.ApiTest;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class ClientErrorTest extends ApiTest {

	@Test
	void anonymousReportsAreLoggedOnOneLineWithoutIdentifyingAnyone(CapturedOutput output) {
		var d = device();
		var res = d.post("/api/client-errors",
				"{\"message\":\"boom\\nFAKE LOG LINE\",\"stack\":\"at a (x.js:1)\\nat b (y.js:2)\",\"lesson\":\"services\",\"kind\":\"error\"}");

		assertThat(res.status()).isEqualTo(204);
		var line = output.getOut().lines().filter((l) -> l.contains("client-error") && l.contains("boom")).findFirst().orElseThrow();
		assertThat(line).contains("lesson=services", "boom ⏎ FAKE LOG LINE", "x.js:1) ⏎ at b").doesNotContain("127.0.0.1");
		assertThat(output.getOut().lines().filter((l) -> l.startsWith("FAKE LOG LINE"))).isEmpty();
	}

	@Test
	void signedInReportsDoNotLogTheAccount(CapturedOutput output) {
		var email = uniqueEmail();
		var d = signedIn(email);
		d.post("/api/client-errors", "{\"message\":\"signed-in boom\"}");

		var line = output.getOut().lines().filter((l) -> l.contains("signed-in boom")).findFirst().orElseThrow();
		assertThat(line).doesNotContain(email).doesNotContain(d.get("/api/me").json().get("id").asString());
	}

	@Test
	void reportsAreValidated() {
		var d = device();
		assertThat(d.post("/api/client-errors", "{\"message\":\"\"}").status()).isEqualTo(400);
		assertThat(d.post("/api/client-errors", "{\"message\":\"" + "x".repeat(501) + "\"}").status()).isEqualTo(400);
		assertThat(d.post("/api/client-errors", "{\"message\":\"ok\",\"lesson\":\"../../etc\"}").status()).isEqualTo(400);
	}

	@Test
	void reportsAreRateLimited() {
		var d = device();
		for (int i = 0; i < ClientErrorController.PER_IP; i++) {
			d.post("/api/client-errors", "{\"message\":\"flood " + i + "\"}");
		}
		try {
			assertThat(d.post("/api/client-errors", "{\"message\":\"one too many\"}").status()).isEqualTo(429);
		}
		finally {
			clock.advance(ClientErrorController.WINDOW);
		}
	}

}
