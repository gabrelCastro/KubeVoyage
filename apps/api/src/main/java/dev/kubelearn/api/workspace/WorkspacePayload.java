package dev.kubelearn.api.workspace;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import dev.kubelearn.api.workspace.Workspace.Design;
import dev.kubelearn.api.workspace.Workspace.Draft;
import dev.kubelearn.api.workspace.Workspace.Release;

/**
 * "Your app" as it arrives over the wire: shape-checked by Bean Validation, then sanitized into
 * canonical form exactly like packages/shared/src/workspace.ts does (the fixtures check it).
 */
public final class WorkspacePayload {

	private WorkspacePayload() {
	}

	public record DesignPayload(@NotNull @Size(min = 1, max = 24) String name, @NotNull @Size(min = 1, max = 16) String emoji,
			@NotNull @Size(min = 1, max = 16) String color, @NotNull @Size(max = 60) String message) {

		/** Unknown emojis or colors (from a newer version, or junk) fall back to the defaults. */
		Design toDesign() {
			var rules = WorkspaceRules.RULES;
			var cleanName = jsTrim(clean(name));
			return new Design(cleanName.isEmpty() ? Design.DEFAULT.name() : cleanName,
					rules.emojis.contains(emoji) ? emoji : Design.DEFAULT.emoji(),
					rules.colors.contains(color) ? color : Design.DEFAULT.color(), jsTrim(clean(message)));
		}

	}

	public record DraftPayload(@NotNull @Valid DesignPayload design, OffsetDateTime designAt, @Size(max = 16_000) String code,
			OffsetDateTime codeAt, boolean customized) {

		public Draft toDraft() {
			return new Draft(design.toDesign(), millis(designAt), code == null ? null : clean(code), millis(codeAt), customized);
		}

	}

	public record ReleasePayload(@NotNull @Size(min = 1, max = 32) String tag, @NotNull @Valid DesignPayload design, boolean broken,
			@Size(max = 16_000) String code, @NotNull OffsetDateTime createdAt) {

		/** Null when the tag isn't one a learner may publish. */
		public Release toRelease() {
			if (!WorkspaceRules.RULES.publishable(tag)) {
				return null;
			}
			return new Release(tag, design.toDesign(), broken, code == null ? null : clean(code), millis(createdAt));
		}

	}

	public record Full(@NotNull @Valid DraftPayload draft, @NotNull @Size(max = 40) List<@NotNull @Valid ReleasePayload> releases) {

		public Workspace toWorkspace() {
			var clean = releases.stream().map(ReleasePayload::toRelease).filter(Objects::nonNull).toList();
			return new Workspace(draft.toDraft(), Workspace.mergeReleases(List.of(), clean));
		}

	}

	// control characters other than tab and line breaks have no business in code or text
	private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]");

	// half of a surrogate pair can't be stored or encoded faithfully: replace it, like JS toWellFormed()
	private static final Pattern LONE_SURROGATE = Pattern.compile("[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]");

	static String clean(String s) {
		return LONE_SURROGATE.matcher(CONTROL.matcher(s).replaceAll("")).replaceAll("\uFFFD");
	}

	/** String.prototype.trim: ECMAScript white space and line terminators, not Java's notion of them. */
	static String jsTrim(String s) {
		int start = 0;
		int end = s.length();
		while (start < end && jsSpace(s.charAt(start))) {
			start++;
		}
		while (end > start && jsSpace(s.charAt(end - 1))) {
			end--;
		}
		return s.substring(start, end);
	}

	private static boolean jsSpace(char c) {
		return c == '\t' || c == '\n' || c == '\u000B' || c == '\f' || c == '\r' || c == ' ' || c == ' ' || c == ' '
				|| c == ' ' || c == '﻿' || Character.getType(c) == Character.SPACE_SEPARATOR;
	}

	private static Instant millis(OffsetDateTime t) {
		return t == null ? null : t.toInstant().truncatedTo(ChronoUnit.MILLIS);
	}

}
