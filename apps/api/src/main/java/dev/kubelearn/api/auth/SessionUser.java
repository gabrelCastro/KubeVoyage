package dev.kubelearn.api.auth;

import java.io.Serializable;
import java.util.UUID;

import org.springframework.security.core.AuthenticatedPrincipal;

/**
 * What a session remembers about who is signed in: only the account id. Everything else
 * is read fresh from the database, so a renamed or deleted account is never stale.
 *
 * {@link #getName()} is the id, which is also how Spring Session indexes sessions by user.
 */
public record SessionUser(UUID id) implements AuthenticatedPrincipal, Serializable {

	@Override
	public String getName() {
		return id.toString();
	}

}
