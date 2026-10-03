package dev.kubelearn.api.progress;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.stereotype.Component;

/**
 * Lesson and objective ids the server accepts. Read from packages/shared/catalog.json
 * (copied onto the classpath at build time) — the same file the web app uses.
 */
@Component
public class LessonCatalog {

	private static final String RESOURCE = "/kubelearn/catalog.json";

	@JsonIgnoreProperties(ignoreUnknown = true)
	record CatalogFile(Map<String, Lesson> lessons) {
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	record Lesson(List<String> required, List<String> optional) {
	}

	private final Map<String, Set<String>> objectives;

	public LessonCatalog() {
		this(read());
	}

	LessonCatalog(CatalogFile file) {
		this.objectives = file.lessons()
			.entrySet()
			.stream()
			.collect(Collectors.toUnmodifiableMap(Map.Entry::getKey,
					e -> Stream.concat(e.getValue().required().stream(), e.getValue().optional().stream())
						.collect(Collectors.toUnmodifiableSet())));
	}

	private static CatalogFile read() {
		try (InputStream in = LessonCatalog.class.getResourceAsStream(RESOURCE)) {
			if (in == null) {
				throw new IllegalStateException(RESOURCE + " is missing from the classpath (it is copied from packages/shared at build time)");
			}
			return JsonMapper.shared().readValue(in, CatalogFile.class);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	public boolean isLesson(String lessonId) {
		return objectives.containsKey(lessonId);
	}

	public boolean isObjective(String lessonId, String objectiveId) {
		var known = objectives.get(lessonId);
		return known != null && known.contains(objectiveId);
	}

	public Set<String> lessonIds() {
		return objectives.keySet();
	}

}
