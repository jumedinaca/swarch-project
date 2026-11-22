package com.geopicto.gateway.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
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
 * Escenario de seguridad 4 (Rate Limiting / Throttling): el gateway corta con
 * 429 a quien supera su cuota, sin tocar el microservicio, y sin afectar a
 * otros clientes. Redis se reemplaza por {@link InMemoryTokenBucketLimiter}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RateLimitTests {

    private static final String SECRET = "test-secret-for-gateway-routing-tests-0123456789";
    private static final MockWebServer backend = startBackend();

    @TestConfiguration
    static class InMemoryLimiterConfig {
        @Bean
        @Primary
        InMemoryTokenBucketLimiter inMemoryTokenBucketLimiter() {
            return new InMemoryTokenBucketLimiter();
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        String backendUrl = "http://localhost:" + backend.getPort();
        for (String service : new String[] { "MESSAGES", "AUTH", "NETWORK", "PROFILE", "RATING", "REPUTATION" }) {
            registry.add(service + "_SERVICE_URL", () -> backendUrl);
        }
        registry.add("SOCKET_GATEWAY_HTTP_URL", () -> backendUrl);
        registry.add("SOCKET_GATEWAY_WS_URL", () -> "ws://localhost:" + backend.getPort());
        registry.add("JWT_SECRET", () -> SECRET);
        // Cuotas pequenas y sin recarga durante la prueba.
        registry.add("RATE_LIMIT_AUTH_CAPACITY", () -> "3");
        registry.add("RATE_LIMIT_AUTH_REFILL", () -> "1");
        registry.add("RATE_LIMIT_AUTH_PERIOD", () -> "1h");
        registry.add("RATE_LIMIT_MESSAGE_CAPACITY", () -> "2");
        registry.add("RATE_LIMIT_MESSAGE_REFILL", () -> "1");
        registry.add("RATE_LIMIT_MESSAGE_PERIOD", () -> "1h");
    }

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private InMemoryTokenBucketLimiter limiter;

    private WebTestClient client;

    @BeforeEach
    void setUp() {
        limiter.reset();
        client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build();
    }

    @AfterAll
    static void stopBackend() throws IOException {
        backend.shutdown();
    }

    @Test
    void loginBruteForceIsCutWith429() {
        for (int i = 3; i >= 1; i--) {
            login().expectStatus().isOk()
                    .expectHeader().valueEquals("X-RateLimit-Limit", "3")
                    .expectHeader().valueEquals("X-RateLimit-Remaining", Integer.toString(i - 1));
        }

        int before = backend.getRequestCount();
        login().expectStatus().isEqualTo(HttpStatus.TOO_MANY_REQUESTS)
                .expectHeader().exists(HttpHeaders.RETRY_AFTER)
                .expectHeader().valueEquals("X-RateLimit-Remaining", "0")
                .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .expectBody().jsonPath("$.message").value(m -> assertThat((String) m).startsWith("Too many requests"));

        // El intento bloqueado no llega al servicio de autenticacion.
        assertThat(backend.getRequestCount()).isEqualTo(before);
    }

    @Test
    void registerSharesTheStrictAuthQuota() {
        for (int i = 0; i < 3; i++) {
            login().expectStatus().isOk();
        }
        client.post().uri("/api/auth/register").contentType(MediaType.APPLICATION_JSON).bodyValue("{}")
                .exchange().expectStatus().isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    void otherAuthEndpointsAreNotLimited() {
        for (int i = 0; i < 5; i++) {
            client.post().uri("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON).bodyValue("{}")
                    .exchange().expectStatus().isOk().expectHeader().doesNotExist("X-RateLimit-Limit");
        }
    }

    @Test
    void messageQuotaIsPerUserAndDoesNotAffectOthers() {
        String abuser = bearer(UUID.randomUUID());
        String other = bearer(UUID.randomUUID());

        postMessage(abuser).expectStatus().isOk();
        postMessage(abuser).expectStatus().isOk();
        postMessage(abuser).expectStatus().isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        // Otro usuario desde la misma IP sigue siendo atendido.
        postMessage(other).expectStatus().isOk();
    }

    @Test
    void readingMessagesIsNotLimitedByWriteQuota() {
        String user = bearer(UUID.randomUUID());
        postMessage(user).expectStatus().isOk();
        postMessage(user).expectStatus().isOk();
        postMessage(user).expectStatus().isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        client.get().uri("/api/messages/" + UUID.randomUUID()).header(HttpHeaders.AUTHORIZATION, user)
                .exchange().expectStatus().isOk();
    }

    @Test
    void invalidTokenIsRejectedBeforeConsumingQuota() {
        client.post().uri("/api/messages").header(HttpHeaders.AUTHORIZATION, "Bearer nope")
                .contentType(MediaType.APPLICATION_JSON).bodyValue("{}")
                .exchange().expectStatus().isUnauthorized();
    }

    @Test
    void redisFailureFailsOpen() {
        limiter.setFailing(true);
        for (int i = 0; i < 5; i++) {
            login().expectStatus().isOk();
        }
    }

    // --- Utilidades ---

    private WebTestClient.ResponseSpec login() {
        return client.post().uri("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"email\":\"victima@geopicto.org\",\"password\":\"adivina\"}").exchange();
    }

    private WebTestClient.ResponseSpec postMessage(String bearer) {
        return client.post().uri("/api/messages").header(HttpHeaders.AUTHORIZATION, bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"content\":\"hola\",\"latitude\":4.6,\"longitude\":-74.08}").exchange();
    }

    private static String bearer(UUID userId) {
        return "Bearer " + Jwts.builder()
                .subject(userId.toString())
                .issuer("geopicto-auth")
                .expiration(Date.from(Instant.now().plus(1, ChronoUnit.HOURS)))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .compact();
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
}
