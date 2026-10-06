package dev.kubelearn.api.workspace;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;

/**
 * "Your app" as it's synced: the draft being edited (design and app.js) and the published
 * images. Any two copies merge without conflicts — in any order, any number of times — and
 * always agree:
 *
 * <ul>
 * <li>draft.design: latest designAt wins (ties: the larger design, so every replica agrees)</li>
 * <li>draft.code: latest codeAt wins, separately from the design</li>
 * <li>draft.customized: or</li>
 * <li>releases: union by tag; a tag is immutable, so if two devices published the same tag the
 * first (earliest createdAt) is the image. At most releasesMax, the earliest.</li>
 * </ul>
 *
 * Mirrors packages/shared/src/workspace.ts; both are checked against the same fixtures. The
 * server stores the code; it never runs it.
 */
public record Workspace(Draft draft, List<Release> releases) {

	public Workspace {
		Objects.requireNonNull(draft);
		releases = List.copyOf(releases);
	}

	public record Design(String name, String emoji, String color, String message) {

		public static final Design DEFAULT = new Design("Meu app", "🐳", "azul", "Olá do cluster!");

		String key() {
			return String.join("\u0000", name, emoji, color, message);
		}

	}

	public record Draft(Design design, Instant designAt, String code, Instant codeAt, boolean customized) {

		public static final Draft EMPTY = new Draft(Design.DEFAULT, null, null, null, false);

		public Draft merge(Draft other) {
			boolean designHere = laterOrLarger(designAt, design.key(), other.designAt, other.design.key());
			boolean codeHere = laterOrLarger(codeAt, codeKey(code), other.codeAt, codeKey(other.code));
			return new Draft(designHere ? design : other.design, designHere ? designAt : other.designAt,
					codeHere ? code : other.code, codeHere ? codeAt : other.codeAt, customized || other.customized);
		}

	}

	public record Release(String tag, Design design, boolean broken, String code, Instant createdAt) {

		String key() {
			return String.join("\u0000", codeKey(code), design.key(), broken ? "1" : "0");
		}

		/** Two releases with the same tag: the first published is the image. */
		public Release winner(Release other) {
			int byTime = createdAt.compareTo(other.createdAt);
			if (byTime != 0) {
				return byTime < 0 ? this : other;
			}
			return key().compareTo(other.key()) >= 0 ? this : other;
		}

	}

	public static Workspace empty() {
		return new Workspace(Draft.EMPTY, List.of());
	}

	/** Commutative, associative and idempotent. */
	public Workspace merge(Workspace other) {
		return new Workspace(draft.merge(other.draft), mergeReleases(releases, other.releases));
	}

	static final Comparator<Release> BY_AGE = Comparator.comparing(Release::createdAt).thenComparing(Release::tag);

	public static List<Release> mergeReleases(List<Release> a, List<Release> b) {
		var byTag = new LinkedHashMap<String, Release>();
		for (var list : List.of(a, b)) {
			for (var r : list) {
				byTag.merge(r.tag(), r, Release::winner);
			}
		}
		var out = new ArrayList<>(byTag.values());
		out.sort(BY_AGE);
		return List.copyOf(out.subList(0, Math.min(out.size(), WorkspaceRules.RULES.releasesMax)));
	}

	private static String codeKey(String code) {
		return code == null ? "0" : "1" + code;
	}

	/** Whether the first value wins: the later edit, or on a tie the larger value. */
	private static boolean laterOrLarger(Instant aAt, String aKey, Instant bAt, String bKey) {
		if (!Objects.equals(aAt, bAt)) {
			return aAt != null && (bAt == null || aAt.isAfter(bAt));
		}
		return aKey.compareTo(bKey) >= 0;
	}

}
