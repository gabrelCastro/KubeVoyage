package dev.kubelearn.api.support;

import java.util.UUID;

import org.junit.jupiter.api.Assertions;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;

import dev.kubelearn.api.TestcontainersConfiguration;

/** A real server on a random port, a real Postgres, and devices that talk to it over HTTP. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "kubelearn.limits.links-per-ip=10000", "kubelearn.limits.verifies-per-ip=10000" })
@Import({ TestcontainersConfiguration.class, ApiTest.Fakes.class })
public abstract class ApiTest {

	@TestConfiguration(proxyBeanMethods = false)
	static class Fakes {

		@Bean
		@Primary
		RecordingMailer recordingMailer() {
			return new RecordingMailer();
		}

		@Bean
		@Primary
		MutableClock mutableClock() {
			return new MutableClock();
		}

	}

	@LocalServerPort
	protected int port;

	@Autowired
	protected RecordingMailer mail;

	@Autowired
	protected MutableClock clock;

	@Autowired
	protected JdbcClient db;

	protected Device device() {
		return new Device(port);
	}

	protected static String uniqueEmail() {
		return "learner+" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
	}

	/** The whole passwordless flow, as the web app performs it. */
	protected Device.Response signIn(Device d, String email) {
		var sent = d.post("/api/auth/magic-link", "{\"email\":\"" + email + "\"}");
		Assertions.assertEquals(202, sent.status(), sent.body());
		var res = d.post("/api/auth/magic-link/verify", "{\"token\":\"" + mail.lastToken(email) + "\"}");
		Assertions.assertEquals(200, res.status(), res.body());
		return res;
	}

	protected Device signedIn(String email) {
		var d = device();
		signIn(d, email);
		return d;
	}

}
