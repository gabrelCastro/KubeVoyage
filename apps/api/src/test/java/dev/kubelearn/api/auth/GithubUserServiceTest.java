package dev.kubelearn.api.auth;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import dev.kubelearn.api.account.UserRepository;
import dev.kubelearn.api.auth.GithubLogin.GithubUserService;
import dev.kubelearn.api.support.ApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class GithubUserServiceTest extends ApiTest {

	@Autowired
	UserRepository users;

	MockRestServiceServer githubApi;

	RestClient client;

	@BeforeEach
	void setUp() {
		var builder = RestClient.builder().baseUrl("https://api.github.com");
		githubApi = MockRestServiceServer.bindTo(builder).build();
		client = builder.build();
	}

	private GithubUserService service(long githubId, String login) {
		Map<String, Object> profile = Map.of("id", githubId, "login", login, "avatar_url", "https://avatars.example/" + login);
		return new GithubUserService((req) -> new DefaultOAuth2User(AuthorityUtils.createAuthorityList("OAUTH2_USER"), profile, "id"), client, users);
	}

	private static OAuth2UserRequest request() {
		var registration = CommonOAuth2Provider.GITHUB.getBuilder("github").clientId("id").clientSecret("secret").build();
		return new OAuth2UserRequest(registration, new OAuth2AccessToken(OAuth2AccessToken.TokenType.BEARER, "gh-token", Instant.now(), Instant.now().plusSeconds(60)));
	}

	private void emails(String json) {
		githubApi.expect(requestTo("https://api.github.com/user/emails"))
			.andExpect(header("Authorization", "Bearer gh-token"))
			.andRespond(withSuccess(json, MediaType.APPLICATION_JSON));
	}

	@Test
	void linksToTheAccountWithTheSameVerifiedEmail() {
		var email = uniqueEmail();
		var existing = signIn(device(), email).json().get("id").asString();
		emails("[{\"email\":\"" + email + "\",\"primary\":true,\"verified\":true}]");

		var user = service(4242L + existing.hashCode(), "ada").loadUser(request());
		var id = (UUID) user.getAttributes().get(GithubUserService.APP_USER_ID);
		assertThat(id.toString()).isEqualTo(existing);
		assertThat(users.providers(id)).containsExactly("email", "github");
	}

	@Test
	void neverLinksByAnUnverifiedEmail() {
		var victim = uniqueEmail();
		signIn(device(), victim);
		emails("[{\"email\":\"" + victim + "\",\"primary\":true,\"verified\":false}]");

		assertThatThrownBy(() -> service(777_000_001L, "mallory").loadUser(request()))
			.isInstanceOf(OAuth2AuthenticationException.class)
			.satisfies((ex) -> assertThat(((OAuth2AuthenticationException) ex).getError().getErrorCode()).isEqualTo("no_verified_email"));
	}

	@Test
	void prefersThePrimaryVerifiedEmail() {
		var primary = uniqueEmail();
		emails("[{\"email\":\"other-" + primary + "\",\"primary\":false,\"verified\":true},{\"email\":\"" + primary + "\",\"primary\":true,\"verified\":true}]");
		var user = service(888_000_000L + primary.hashCode(), "grace").loadUser(request());
		var account = users.findById((UUID) user.getAttributes().get(GithubUserService.APP_USER_ID)).orElseThrow();
		assertThat(account.email()).isEqualTo(primary);
		assertThat(account.displayName()).isEqualTo("grace");
	}

	@Test
	void theSameGithubAccountAlwaysLandsInTheSameKubeLearnAccount() {
		var email = uniqueEmail();
		long githubId = 999_000_000L + email.hashCode();
		emails("[{\"email\":\"" + email + "\",\"primary\":true,\"verified\":true}]");
		var first = service(githubId, "linus").loadUser(request()).getAttributes().get(GithubUserService.APP_USER_ID);
		githubApi.reset();
		// even if their GitHub email changes later
		emails("[{\"email\":\"new-" + email + "\",\"primary\":true,\"verified\":true}]");
		var second = service(githubId, "linus").loadUser(request()).getAttributes().get(GithubUserService.APP_USER_ID);
		assertThat(second).isEqualTo(first);
		assertThat(List.of(first)).doesNotContainNull();
	}

}
