package dev.kubelearn.api.workspace;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.Example;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import tools.jackson.databind.json.JsonMapper;

import dev.kubelearn.api.workspace.Workspace.Design;
import dev.kubelearn.api.workspace.Workspace.Draft;
import dev.kubelearn.api.workspace.Workspace.Release;
import dev.kubelearn.api.workspace.WorkspacePayload.Full;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Same guarantees as packages/shared/test/workspace.test.ts — and the same answers, case by
 * case, as the TypeScript implementation (fixtures generated from it, sanitizing included).
 */
class WorkspaceMergeTest {

	private static final JsonMapper JSON = JsonMapper.shared();

	record Fixture(String name, Full a, Full b, Full merged) {
	}

	record Fixtures(List<Fixture> cases) {
	}

	@Example
	void agreesWithTheTypeScriptImplementationOnEveryFixture() throws IOException {
		var fixtures = JSON.readValue(Files.readString(Path.of("../../packages/shared/fixtures/workspace-cases.json")), Fixtures.class);
		assertThat(fixtures.cases()).hasSizeGreaterThan(100);
		for (var c : fixtures.cases()) {
			var merged = c.a().toWorkspace().merge(c.b().toWorkspace());
			assertThat(merged).as(c.name()).isEqualTo(c.merged().toWorkspace());
		}
	}

	@Example
	void theLimitsInTheAnnotationsMatchTheSharedRules() throws IOException {
		var rules = JSON.readTree(Files.readString(Path.of("../../packages/shared/workspace.json")));
		assertThat(rules.get("codeMax").asInt()).isEqualTo(16_000);
		assertThat(rules.get("design").get("nameMax").asInt()).isEqualTo(24);
		assertThat(rules.get("design").get("messageMax").asInt()).isEqualTo(60);
		assertThat(rules.get("releasesMax").asInt() * 2).isEqualTo(40);
	}

	@Example
	void trimsLikeJavaScript() {
		assertThat(WorkspacePayload.jsTrim(" 　 oi ﻿\n")).isEqualTo("oi");
		assertThat(WorkspacePayload.clean("a\u0000b\tc\u007F")).isEqualTo("ab\tc");
		assertThat(WorkspacePayload.clean("x\uD800y\uDC00z🐳")).isEqualTo("x\uFFFDy\uFFFDz🐳");
	}

	@Example
	void tagsTheLessonsUseAreNotPublishable() {
		var rules = WorkspaceRules.RULES;
		assertThat(rules.publishable("2.0")).isTrue();
		assertThat(rules.publishable("v_1.0-rc")).isTrue();
		assertThat(rules.publishable("1.4")).isFalse();
		assertThat(rules.publishable("latest")).isFalse();
		assertThat(rules.publishable("-x")).isFalse();
		assertThat(rules.publishable("a".repeat(33))).isFalse();
		assertThat(rules.publishable("abc\n")).isFalse();
	}

	@Property
	void isCommutative(@ForAll("workspace") Workspace a, @ForAll("workspace") Workspace b) {
		assertThat(a.merge(b)).isEqualTo(b.merge(a));
	}

	@Property
	void isAssociative(@ForAll("workspace") Workspace a, @ForAll("workspace") Workspace b, @ForAll("workspace") Workspace c) {
		assertThat(a.merge(b).merge(c)).isEqualTo(a.merge(b.merge(c)));
	}

	@Property
	void isIdempotent(@ForAll("workspace") Workspace a) {
		assertThat(a.merge(a)).isEqualTo(a);
	}

	@Provide
	Arbitrary<Workspace> workspace() {
		// few distinct values, so ties, same-tag collisions and the cap all happen
		var instants = Arbitraries.longs().between(0, 40).map((m) -> Instant.ofEpochMilli(1_780_000_000_000L + m * 60_000));
		var design = Combinators.combine(Arbitraries.of("Meu app", "Raposa"), Arbitraries.of("🐳", "🦊"), Arbitraries.of("azul", "rosa"),
				Arbitraries.of("", "oi"))
			.as(Design::new);
		var code = Arbitraries.of("console.log(1)", "", "function handle() {}").injectNull(0.3);
		var draft = Combinators.combine(design, instants.injectNull(0.3), code, instants.injectNull(0.3), Arbitraries.of(true, false))
			.as(Draft::new);
		var release = Combinators.combine(Arbitraries.integers().between(0, 30).map((n) -> "t" + n), design, Arbitraries.of(true, false), code,
				instants)
			.as(Release::new);
		return Combinators.combine(draft, release.list().ofMaxSize(25))
			.as((d, rs) -> new Workspace(d, Workspace.mergeReleases(List.of(), rs)));
	}

}
