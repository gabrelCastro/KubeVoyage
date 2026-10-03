package dev.kubelearn.api;

import java.net.URI;
import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("kubelearn")
public record KubelearnProperties(
		/** Origin the browser sees. Sign-in links and redirects point here. */
		URI publicUrl,
		String mailFrom,
		@DefaultValue("10m") Duration magicLinkTtl,
		@DefaultValue Github github,
		@DefaultValue Limits limits) {

	public record Github(String clientId, String clientSecret) {
		public boolean enabled() {
			return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
		}
	}

	/** Abuse limits for the sign-in endpoints (in-memory, per instance). */
	public record Limits(
			@DefaultValue("3") int linksPerEmail,
			@DefaultValue("10m") Duration linksPerEmailWindow,
			@DefaultValue("10") int linksPerIp,
			@DefaultValue("1h") Duration linksPerIpWindow,
			@DefaultValue("20") int verifiesPerIp,
			@DefaultValue("10m") Duration verifiesPerIpWindow) {
	}

	/** Public URL with a path appended, e.g. {@code url("/auth/verify")}. */
	public String url(String path) {
		var base = publicUrl.toString();
		return (base.endsWith("/") ? base.substring(0, base.length() - 1) : base) + path;
	}

}
