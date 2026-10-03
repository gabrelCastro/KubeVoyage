package dev.kubelearn.api.ops;

import java.time.Duration;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import dev.kubelearn.api.common.RateLimiter;

/**
 * Errors that happen in the browser, written to the API's log so they can be seen at all.
 * Kept in-house on purpose: no third party receives anything about the people using the app.
 * Nothing identifying is logged: no IP, no account, no email.
 */
@RestController
class ClientErrorController {

	private static final Logger log = LoggerFactory.getLogger("client-error");

	static final int PER_IP = 30;

	static final Duration WINDOW = Duration.ofMinutes(10);

	record ClientError(@NotBlank @Size(max = 500) String message, @Size(max = 4000) String stack,
			@Size(max = 40) @Pattern(regexp = "[a-z0-9-]*") String lesson, @Size(max = 40) String kind) {
	}

	private final RateLimiter limiter;

	ClientErrorController(RateLimiter limiter) {
		this.limiter = limiter;
	}

	@PostMapping("/api/client-errors")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void report(@RequestBody @Validated ClientError error, HttpServletRequest http) {
		limiter.hit("client-error:ip:" + http.getRemoteAddr(), PER_IP, WINDOW);
		log.warn("kind={} lesson={} message=\"{}\" stack=\"{}\"", oneLine(error.kind()), oneLine(error.lesson()), oneLine(error.message()),
				oneLine(error.stack()));
	}

	/** One log line per report, whatever the browser sent (no forged extra lines). */
	static String oneLine(String s) {
		if (s == null || s.isEmpty()) {
			return "-";
		}
		return s.replaceAll("[\\r\\n]+", " ⏎ ").replaceAll("\\p{Cntrl}", "?").replace("\"", "'");
	}

}
