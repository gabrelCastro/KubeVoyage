package dev.kubelearn.api.support;

import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse.BodyHandlers;
import java.util.Optional;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * One browser: its own cookie jar, and the same CSRF dance the web app does
 * (read XSRF-TOKEN, echo it as X-XSRF-TOKEN on writes).
 */
public final class Device {

	public record Response(int status, String body, HttpHeaders headers) {

		public JsonNode json() {
			return JsonMapper.shared().readTree(body);
		}

		public Optional<String> setCookie(String name) {
			return headers.allValues("set-cookie").stream().filter((c) -> c.startsWith(name + "=")).findFirst();
		}

	}

	private final URI base;

	private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);

	private final HttpClient http;

	public Device(int port) {
		this.base = URI.create("http://localhost:" + port);
		this.http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).cookieHandler(cookies).build();
	}

	public Response get(String path) {
		return send(HttpRequest.newBuilder(base.resolve(path)).GET(), false);
	}

	public Response post(String path, String json) {
		return send(HttpRequest.newBuilder(base.resolve(path)).POST(BodyPublishers.ofString(json)), true);
	}

	public Response put(String path, String json) {
		return send(HttpRequest.newBuilder(base.resolve(path)).PUT(BodyPublishers.ofString(json)), true);
	}

	public Response delete(String path) {
		return send(HttpRequest.newBuilder(base.resolve(path)).DELETE(), true);
	}

	/** Like {@link #put} but without the CSRF header — what a forged cross-site request looks like. */
	public Response putWithoutCsrf(String path, String json) {
		return send(HttpRequest.newBuilder(base.resolve(path)).PUT(BodyPublishers.ofString(json)), false);
	}

	public Optional<String> cookie(String name) {
		return cookies.getCookieStore().getCookies().stream().filter((c) -> c.getName().equals(name)).map(HttpCookie::getValue).findFirst();
	}

	/** Replace this device's session cookie — e.g. to replay a stolen or stale one. */
	public void forceSessionCookie(String value) {
		cookies.getCookieStore().removeAll();
		var c = new HttpCookie("kl_session", value);
		c.setPath("/");
		c.setVersion(0);
		cookies.getCookieStore().add(base, c);
	}

	public void ensureCsrf() {
		if (cookie("XSRF-TOKEN").isEmpty()) {
			get("/api/auth/csrf");
		}
	}

	private Response send(HttpRequest.Builder req, boolean csrf) {
		req.header("Content-Type", "application/json").header("Accept", "application/json");
		if (csrf) {
			ensureCsrf();
			cookie("XSRF-TOKEN").ifPresent((t) -> req.header("X-XSRF-TOKEN", t));
		}
		try {
			var res = http.send(req.build(), BodyHandlers.ofString());
			return new Response(res.statusCode(), res.body(), res.headers());
		}
		catch (IOException ex) {
			throw new java.io.UncheckedIOException(ex);
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException(ex);
		}
	}

}
