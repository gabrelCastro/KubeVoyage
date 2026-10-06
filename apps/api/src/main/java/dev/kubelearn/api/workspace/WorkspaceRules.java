package dev.kubelearn.api.workspace;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import tools.jackson.databind.json.JsonMapper;

/**
 * What "your app" may contain: emojis, colors, lengths, tags. Read from
 * packages/shared/workspace.json (copied onto the classpath at build time) — the same file
 * the web app uses.
 */
public final class WorkspaceRules {

	private static final String RESOURCE = "/kubelearn/workspace.json";

	@JsonIgnoreProperties(ignoreUnknown = true)
	record DesignFile(List<String> emojis, List<String> colors, int nameMax, int messageMax) {
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	record RulesFile(DesignFile design, int codeMax, int releasesMax, String tagPattern, String reservedTagPattern) {
	}

	public static final WorkspaceRules RULES = new WorkspaceRules(read());

	final Set<String> emojis;

	final Set<String> colors;

	final int codeMax;

	final int releasesMax;

	private final Pattern tag;

	private final Pattern reserved;

	private WorkspaceRules(RulesFile file) {
		this.emojis = Set.copyOf(file.design().emojis());
		this.colors = Set.copyOf(file.design().colors());
		this.codeMax = file.codeMax();
		this.releasesMax = file.releasesMax();
		this.tag = Pattern.compile(file.tagPattern());
		this.reserved = Pattern.compile(file.reservedTagPattern());
	}

	/** A tag a learner may publish: well-formed, and not one of the lessons' (1.x) or `latest`. */
	public boolean publishable(String tag) {
		// matches(), not find(): Java's $ would also match before a trailing newline
		return this.tag.matcher(tag).matches() && !this.reserved.matcher(tag).matches();
	}

	private static RulesFile read() {
		try (InputStream in = WorkspaceRules.class.getResourceAsStream(RESOURCE)) {
			if (in == null) {
				throw new IllegalStateException(RESOURCE + " is missing from the classpath (it is copied from packages/shared at build time)");
			}
			return JsonMapper.shared().readValue(in, RulesFile.class);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

}
