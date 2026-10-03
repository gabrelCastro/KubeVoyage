package dev.kubelearn.api.progress;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;

import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import net.jqwik.api.Example;
import tools.jackson.databind.json.JsonMapper;

import dev.kubelearn.api.progress.Progress.LastLesson;
import dev.kubelearn.api.progress.Progress.LessonProgress;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Same guarantees as packages/shared/test/progress.test.ts — and the same answers, case
 * by case, as the TypeScript implementation (fixtures generated from it).
 */
class ProgressMergeTest {

	private static final LessonCatalog CATALOG = new LessonCatalog();

	private static final JsonMapper JSON = JsonMapper.shared();

	record Fixture(String name, ProgressPayload a, ProgressPayload b, ProgressPayload merged) {
	}

	record Fixtures(List<Fixture> cases) {
	}

	@Example
	void agreesWithTheTypeScriptImplementationOnEveryFixture() throws IOException {
		var file = Path.of("../../packages/shared/fixtures/merge-cases.json");
		var fixtures = JSON.readValue(Files.readString(file), Fixtures.class);
		assertThat(fixtures.cases()).hasSizeGreaterThan(100);
		for (var c : fixtures.cases()) {
			var merged = c.a().toProgress(CATALOG).merge(c.b().toProgress(CATALOG));
			assertThat(merged).as(c.name()).isEqualTo(c.merged().toProgress(CATALOG));
		}
	}

	@Property
	void isCommutative(@ForAll("progress") Progress a, @ForAll("progress") Progress b) {
		assertThat(a.merge(b)).isEqualTo(b.merge(a));
	}

	@Property
	void isAssociative(@ForAll("progress") Progress a, @ForAll("progress") Progress b, @ForAll("progress") Progress c) {
		assertThat(a.merge(b).merge(c)).isEqualTo(a.merge(b.merge(c)));
	}

	@Property
	void isIdempotent(@ForAll("progress") Progress a) {
		assertThat(a.merge(a)).isEqualTo(a);
	}

	@Property
	void neverLosesAnObjectiveOrACompletion(@ForAll("progress") Progress a, @ForAll("progress") Progress b) {
		var m = a.merge(b);
		for (var side : List.of(a, b)) {
			side.lessons().forEach((id, lp) -> {
				assertThat(m.lessons().get(id).objectives()).containsAll(lp.objectives());
				if (lp.completed()) {
					assertThat(m.lessons().get(id).completed()).isTrue();
				}
			});
		}
	}

	@Provide
	Arbitrary<Progress> progress() {
		var ids = new ArrayList<>(CATALOG.lessonIds());
		var instants = Arbitraries.longs().between(1_700_000_000_000L, 1_900_000_000_000L).map(Instant::ofEpochMilli);
		Arbitrary<LessonProgress> lesson = Combinators.combine(
				Arbitraries.of("apply", "get", "delete", "heal", "chaos").list().ofMaxSize(5),
				instants.injectNull(0.5), Arbitraries.integers().between(1, 3_600_000).injectNull(0.3))
			.as((objectives, completedAt, best) -> new LessonProgress(objectives, completedAt, completedAt == null ? null : best));
		var lessons = Arbitraries.maps(Arbitraries.of(ids), lesson).ofMaxSize(4).map(TreeMap::new);
		var last = Combinators.combine(Arbitraries.of(ids), instants).as(LastLesson::new).injectNull(0.3);
		return Combinators.combine(lessons, last).as(Progress::new);
	}

}
