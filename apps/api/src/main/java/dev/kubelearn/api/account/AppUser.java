package dev.kubelearn.api.account;

import java.time.Instant;
import java.util.UUID;

public record AppUser(UUID id, String email, String displayName, String avatarUrl, Instant createdAt) {
}
