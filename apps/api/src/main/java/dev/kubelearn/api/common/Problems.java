package dev.kubelearn.api.common;

import java.net.URI;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

/** RFC 9457 problems with a stable, machine-readable {@code code} the web app switches on. */
public final class Problems {

	private Problems() {
	}

	public static ProblemDetail of(HttpStatus status, String code, String detail) {
		var p = ProblemDetail.forStatusAndDetail(status, detail);
		p.setType(URI.create("https://kubelearn.dev/problems/" + code));
		p.setProperty("code", code);
		return p;
	}

}
