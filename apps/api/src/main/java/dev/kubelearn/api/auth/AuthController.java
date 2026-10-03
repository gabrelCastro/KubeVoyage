package dev.kubelearn.api.auth;

import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.kubelearn.api.KubelearnProperties;

@RestController
@RequestMapping("/api/auth")
class AuthController {

	record Providers(boolean email, boolean github) {
	}

	record Csrf(String headerName, String token) {
	}

	private final KubelearnProperties props;

	AuthController(KubelearnProperties props) {
		this.props = props;
	}

	/** Which sign-in methods this deployment offers. */
	@GetMapping("/providers")
	Providers providers() {
		return new Providers(true, props.github().enabled());
	}

	/** Touching the token makes Spring write the XSRF-TOKEN cookie the web app echoes back. */
	@GetMapping("/csrf")
	Csrf csrf(CsrfToken token) {
		return new Csrf(token.getHeaderName(), token.getToken());
	}

}
