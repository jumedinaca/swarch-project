package com.geopicto.gateway.revocation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * Escenario de seguridad 5 (Token Revocation Blacklist): un token valido deja
 * de servir en el gateway en cuanto su sesion queda en la blacklist, sin tocar
 * el microservicio. Redis se reemplaza por {@link InMemoryTokenRevocationChecker}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TokenBlacklistTests {

    private static final String SECRET = "test-secret-for-gateway-routing-tests-0123456789";
    private static final String ISSUER = "geopicto-auth";
    private static final MockWebServer backend = startBackend();
    private static final int UNREACHABLE_PORT = findClosedPort();

    @TestConfiguration
    static class InMemoryBlacklistConfig {
        @Bean
        @Primary
        InMemoryTokenRevocationChecker inMemoryTokenRevocationChecker() {
            return new InMemoryTokenRevocationChecker();
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        String backendUrl = "http://localhost:" + backend.getPort();
        for (String service : new String[] { "MESSAGES", "AUTH", "NETWORK", "PROFILE", "RATING" }) {
            registry.add(service + "_SERVICE_URL", () -> backendUrl);
        }
        registry.add("REPUTATION_SERVICE_URL", () -> "http://127.0.0.1:" + UNREACHABLE_PORT);
        registry.add("SOCKET_GATEWAY_HTTP_URL", () -> backendUrl);
        registry.add("SOCKET_GATEWAY_WS_URL", () -> "ws://localhost:" + backend.getPort());
        registry.add("JWT_SECRET", () -> SECRET);
        registry.add("TOKEN_BLACKLIST_ENABLED", () -> "true");
        // El Rate Limiting se prueba aparte (RateLimitTests); aqui no hay Redis.
        registry.add("RATE_LIMIT_ENABLED", () -> "false");
    }

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private InMemoryTokenRevocationChecker checker;

    private WebTestClient client;

    @BeforeEach
    void setUp() throws InterruptedException {
        checker.reset();
        // Descarta peticiones que otros tests reenviaron y no consumieron: el
        // MockWebServer es compartido y JUnit no garantiza el orden de los tests.
        while (backend.takeRequest(0, java.util.concurrent.TimeUnit.MILLISECONDS) != null) {
        }
        client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build();
    }

    @AfterAll
    static void stopBackend() throws IOException {
        backend.shutdown();
    }

    @Test
    void validTokenIsForwarded() throws InterruptedException {
        UUID userId = UUID.randomUUID();
        String bearer = "Bearer " + token(userId, UUID.randomUUID(), UUID.randomUUID().toString());

        client.get().uri("/api/profiles/me").header(HttpHeaders.AUTHORIZATION, bearer)
                .exchange().expectStatus().isOk();

        RecordedRequest forwarded = takeForwarded();
        assertThat(forwarded.getPath()).isEqualTo("/profiles/me");
        assertThat(forwarded.getHeader("X-User-ID")).isEqualTo(userId.toString());
    }

    @Test
    void revokedSessionIsRejectedWith401() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        checker.revokeSession(sessionId);

        expectUnauthorized(token(userId, sessionId, UUID.randomUUID().toString()),
                "Token has been revoked");
    }

    @Test
    void revokedJtiIsRejectedWith401() {
        UUID userId = UUID.randomUUID();
        String tokenId = UUID.randomUUID().toString();
        checker.revokeToken(tokenId);

        expectUnauthorized(token(userId, UUID.randomUUID(), tokenId), "Token has been revoked");
    }

    @Test
    void revokingOneSessionDoesNotAffectAnother() {
        UUID userId = UUID.randomUUID();
        checker.revokeSession(UUID.randomUUID());

        client.get().uri("/api/profiles/me")
                .header(HttpHeaders.AUTHORIZATION,
                        "Bearer " + token(userId, UUID.randomUUID(), UUID.randomUUID().toString()))
                .exchange().expectStatus().isOk();
    }

    @Test
    void legacyTokenWithoutSidOrJtiIsForwarded() {
        // scripts/dev-token.mjs puede emitir tokens sin sid/jti. Los tokens de
        // services/auth siempre los incluyen; sin ellos no hay clave que buscar.
        client.get().uri("/api/profiles/me")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token(UUID.randomUUID(), null, null))
                .exchange().expectStatus().isOk();
    }

    @Test
    void blacklistFailureReturns503WhenFailClosed() {
        checker.setFailing(true);

        client.get().uri("/api/profiles/me")
                .header(HttpHeaders.AUTHORIZATION,
                        "Bearer " + token(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID().toString()))
                .exchange().expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectBody().jsonPath("$.message").isEqualTo("Token revocation check unavailable");
    }

    @Test
    void downstreamFailureIsNotMaskedAsRevocationCheckUnavailable() {
        String bearer = "Bearer " + token(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID().toString());

        client.get().uri("/api/reputation/me")
                .header(HttpHeaders.AUTHORIZATION, bearer)
                .exchange()
                .expectStatus().is5xxServerError()
                .expectBody(String.class)
                .value(body -> assertThat(body == null ? "" : body)
                        .doesNotContain("Token revocation check unavailable"));
    }

    // --- Utilidades ---

    private void expectUnauthorized(String token, String message) {
        int before = backend.getRequestCount();

        client.get().uri("/api/profiles/me")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange().expectStatus().isUnauthorized()
                .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .expectBody().jsonPath("$.message").isEqualTo(message);

        assertThat(backend.getRequestCount()).isEqualTo(before);
    }

    private RecordedRequest takeForwarded() throws InterruptedException {
        RecordedRequest request = backend.takeRequest(5, java.util.concurrent.TimeUnit.SECONDS);
        assertThat(request).as("la peticion deberia llegar al backend").isNotNull();
        return request;
    }

    private static String token(UUID subject, UUID sessionId, String tokenId) {
        var builder = Jwts.builder()
                .subject(subject.toString())
                .issuer(ISSUER)
                .expiration(Date.from(Instant.now().plus(1, ChronoUnit.HOURS)))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)));
        if (sessionId != null) {
            builder.claim("sid", sessionId.toString());
        }
        if (tokenId != null) {
            builder.claim("jti", tokenId);
        }
        return builder.compact();
    }

    private static MockWebServer startBackend() {
        MockWebServer server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                return new MockResponse().setResponseCode(200)
                        .setHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE).setBody("{}");
            }
        });
        try {
            server.start();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return server;
    }

    private static int findClosedPort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
