package dev.kubelearn.api.common;

import java.util.Map;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** Every API error is an RFC 9457 problem, with a stable machine-readable {@code code}. */
@RestControllerAdvice
class ApiExceptionHandler extends ResponseEntityExceptionHandler {

	@ExceptionHandler(TooManyRequestsException.class)
	ResponseEntity<ProblemDetail> tooMany(TooManyRequestsException ex) {
		long seconds = Math.max(1, ex.retryAfter().toSeconds());
		var p = Problems.of(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", "Too many attempts. Try again in a moment.");
		p.setProperty("retryAfterSeconds", seconds);
		return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).header(HttpHeaders.RETRY_AFTER, String.valueOf(seconds)).body(p);
	}

	@ExceptionHandler(ApiException.class)
	ResponseEntity<ProblemDetail> api(ApiException ex) {
		return ResponseEntity.status(ex.status()).body(Problems.of(ex.status(), ex.code(), ex.getMessage()));
	}

	@Override
	protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex, HttpHeaders headers,
			HttpStatusCode status, WebRequest request) {
		var p = Problems.of(HttpStatus.BAD_REQUEST, "invalid_request", "Some fields are invalid.");
		p.setProperty("errors", ex.getBindingResult()
			.getFieldErrors()
			.stream()
			.map((e) -> Map.of("field", e.getField(), "message", String.valueOf(e.getDefaultMessage())))
			.toList());
		return ResponseEntity.badRequest().body(p);
	}

}
