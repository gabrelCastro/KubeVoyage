package dev.kubelearn.api.auth;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MagicLinkEmailTest {

	@Test
	void htmlEscapesWhatItInterpolates() {
		var html = SmtpMagicLinkMailer.html("<script>@x.com", "http://localhost:5180/auth/verify#token=a\"b", Duration.ofMinutes(10));
		assertThat(html).doesNotContain("<script>").contains("&lt;script&gt;").doesNotContain("token=a\"b");
	}

	@Test
	void plainTextVersionHasTheLinkAndTheExpiry() {
		var text = SmtpMagicLinkMailer.text("http://x/auth/verify#token=t", Duration.ofMinutes(10));
		assertThat(text).contains("http://x/auth/verify#token=t").contains("10 minutos");
	}

}
