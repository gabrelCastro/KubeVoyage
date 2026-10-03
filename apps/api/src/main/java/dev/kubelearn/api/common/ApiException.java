package dev.kubelearn.api.common;

import org.springframework.http.HttpStatus;

/** An expected failure with a status and a stable code the client can switch on. */
public class ApiException extends RuntimeException {

	private final HttpStatus status;

	private final String code;

	public ApiException(HttpStatus status, String code, String message) {
		super(message);
		this.status = status;
		this.code = code;
	}

	public HttpStatus status() {
		return status;
	}

	public String code() {
		return code;
	}

}
