package com.geopicto.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import javax.crypto.SecretKey;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * Levanta el gateway completo contra un backend simulado (MockWebServer) que
 * hace de servicio de mensajes y de autenticacion, y verifica el enrutamiento,
 * el filtro JwtAuth y el manejo del header X-User-ID.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GatewayRoutingTests {

    private static final String SECRET = "test-secret-for-gateway-routing-tests-0123456789";
    private static final String ISSUER = "geopicto-auth";
    private static final String ALLOWED_ORIGIN = "http://localhost:8081";
    private static final MockWebServer backend = startBackend();

    @Value("${local.server.port}")
    private int port;

    private WebTestClient client;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        String backendUrl = "http://localhost:" + backend.getPort();
        registry.add("MESSAGES_SERVICE_URL", () -> backendUrl);
        registry.add("AUTH_SERVICE_URL", () -> backendUrl);
        registry.add("NETWORK_SERVICE_URL", () -> backendUrl);
        registry.add("JWT_SECRET", () -> SECRET);
        registry.add("CORS_ALLOWED_ORIGINS", () -> ALLOWED_ORIGIN);
    }

    @AfterAll
    static void stopBackend() throws IOException {
        backend.shutdown();
    }

    @BeforeEach
    void setUp() throws InterruptedException {
        // Descarta peticiones que una prueba fallida haya dejado sin consumir,
        // para que el fallo no se propague a las pruebas siguientes.
        while (backend.takeRequest(10, TimeUnit.MILLISECONDS) != null) {
        }

        client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build();
        backend.enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .setBody("[]"));
    }

    // --- Rutas publicas ---

    @Test
    void nearbyIsPublicAndStripsApiPrefix() throws InterruptedException {
        client.get().uri("/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500")
                .exchange()
                .expectStatus().isOk()
                .expectBody().json("[]");

        RecordedRequest forwarded = takeForwarded();
        assertThat(forwarded.getPath()).isEqualTo("/messages/nearby?lat=4.6371&lng=-74.0834&radius=500");
    }

    @Test
    void nearbyDropsClientSuppliedUserId() throws InterruptedException {
        client.get().uri("/api/messages/nearby?lat=0&lng=0&radius=100")
                .header("X-User-ID", UUID.randomUUID().toString())
                .exchange()
                .expectStatus().isOk();

        assertThat(takeForwarded().getHeader("X-User-ID")).isNull();
    }

    @Test
    void authRoutesArePublicAndDropClientSuppliedUserId() throws InterruptedException {
        client.post().uri("/api/auth/login")
                .header("X-User-ID", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isOk();

        RecordedRequest forwarded = takeForwarded();
        assertThat(forwarded.getPath()).isEqualTo("/auth/login");
        assertThat(forwarded.getHeader("X-User-ID")).isNull();
    }

    // --- Rutas protegidas ---

    @Test
    void validTokenIsReplacedByUserIdHeader() throws InterruptedException {
        UUID userId = UUID.randomUUID();

        client.post().uri("/api/messages")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token(userId.toString(), inOneHour()))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"content\":\"hola\",\"latitude\":4.6,\"longitude\":-74.08}")
                .exchange()
                .expectStatus().isOk();

        RecordedRequest forwarded = takeForwarded();
        assertThat(forwarded.getPath()).isEqualTo("/messages");
        assertThat(forwarded.getHeader("X-User-ID")).isEqualTo(userId.toString());
        assertThat(forwarded.getHeader(HttpHeaders.AUTHORIZATION)).isNull();
        assertThat(forwarded.getBody().readString(StandardCharsets.UTF_8)).contains("\"content\":\"hola\"");
    }

    @Test
    void validTokenOverridesForgedUserIdHeader() throws InterruptedException {
        UUID userId = UUID.randomUUID();

        client.delete().uri("/api/messages/" + UUID.randomUUID())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token(userId.toString(), inOneHour()))
                .header("X-User-ID", UUID.randomUUID().toString())
                .exchange()
                .expectStatus().isOk();

        assertThat(takeForwarded().getHeaders().values("X-User-ID")).containsExactly(userId.toString());
    }

    @Test
    void networkRoutesRequireTokenAndStripNetworkPrefix() throws InterruptedException {
        UUID userId = UUID.randomUUID();

        client.get().uri("/api/network/friends?limit=10")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token(userId.toString(), inOneHour()))
                .exchange()
                .expectStatus().isOk();

        RecordedRequest forwarded = takeForwarded();
        assertThat(forwarded.getPath()).isEqualTo("/friends?limit=10");
        assertThat(forwarded.getHeader("X-User-ID")).isEqualTo(userId.toString());
        assertThat(forwarded.getHeader(HttpHeaders.AUTHORIZATION)).isNull();
    }

    @Test
    void networkGraphqlIsForwardedWithUserId() throws InterruptedException {
        UUID userId = UUID.randomUUID();

        client.post().uri("/api/network/graphql")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token(userId.toString(), inOneHour()))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"query\":\"{ friends { id } }\"}")
                .exchange()
                .expectStatus().isOk();

        RecordedRequest forwarded = takeForwarded();
        assertThat(forwarded.getPath()).isEqualTo("/graphql");
        assertThat(forwarded.getHeader("X-User-ID")).isEqualTo(userId.toString());
        assertThat(forwarded.getBody().readString(StandardCharsets.UTF_8)).contains("friends");
    }

    @Test
    void networkRoutesWithoutTokenAreRejected() {
        expectUnauthorized(client.get().uri("/api/network/friends").exchange(),
                "Missing or invalid Authorization header");
    }

    @Test
    void missingTokenIsRejected() {
        expectUnauthorized(client.post().uri("/api/messages")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange(), "Missing or invalid Authorization header");
    }

    @Test
    void forgedUserIdWithoutTokenIsRejected() {
        expectUnauthorized(client.post().uri("/api/messages")
                .header("X-User-ID", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange(), "Missing or invalid Authorization header");
    }

    @Test
    void expiredTokenIsRejected() {
        String expired = token(UUID.randomUUID().toString(), Date.from(Instant.now().minus(1, ChronoUnit.MINUTES)));
        expectUnauthorized(withToken(expired), "Invalid or expired token");
    }

    @Test
    void tokenSignedWithAnotherSecretIsRejected() {
        SecretKey otherKey = Keys.hmacShaKeyFor(
                "another-secret-that-is-also-at-least-32-bytes".getBytes(StandardCharsets.UTF_8));
        String forged = Jwts.builder()
                .subject(UUID.randomUUID().toString())
                .issuer(ISSUER)
                .expiration(inOneHour())
                .signWith(otherKey)
                .compact();
        expectUnauthorized(withToken(forged), "Invalid or expired token");
    }

    @Test
    void tokenWithoutSubjectIsRejected() {
        expectUnauthorized(withToken(token(null, inOneHour())), "Invalid or expired token");
    }

    @Test
    void tokenWithNonUuidSubjectIsRejected() {
        expectUnauthorized(withToken(token("user-demo-1", inOneHour())), "Invalid or expired token");
    }

    @Test
    void tokenWithoutExpirationIsRejected() {
        expectUnauthorized(withToken(token(UUID.randomUUID().toString(), null)), "Invalid or expired token");
    }

    @Test
    void tokenFromAnotherIssuerIsRejected() {
        expectUnauthorized(withToken(token(UUID.randomUUID().toString(), inOneHour(), "someone-else")),
                "Invalid or expired token");
    }

    @Test
    void tokenWithoutIssuerIsRejected() {
        expectUnauthorized(withToken(token(UUID.randomUUID().toString(), inOneHour(), null)),
                "Invalid or expired token");
    }

    @Test
    void malformedTokenIsRejected() {
        expectUnauthorized(withToken("not-a-jwt"), "Invalid or expired token");
    }

    // --- Infraestructura ---

    @Test
    void healthEndpointIsUp() {
        client.get().uri("/actuator/health")
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.status").isEqualTo("UP");
    }

    @Test
    void corsPreflightAllowsConfiguredOrigin() {
        client.options().uri("/api/messages")
                .header(HttpHeaders.ORIGIN, ALLOWED_ORIGIN)
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED_ORIGIN);
    }

    @Test
    void corsPreflightAllowsPatch() {
        client.options().uri("/api/auth/profile")
                .header(HttpHeaders.ORIGIN, ALLOWED_ORIGIN)
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "PATCH")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED_ORIGIN);
    }

    @Test
    void corsPreflightRejectsUnknownOrigin() {
        client.options().uri("/api/messages")
                .header(HttpHeaders.ORIGIN, "http://evil.example")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .exchange()
                .expectStatus().isForbidden();
    }

    // --- Utilidades ---

    private WebTestClient.ResponseSpec withToken(String token) {
        return client.get().uri("/api/messages/" + UUID.randomUUID())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange();
    }

    private void expectUnauthorized(WebTestClient.ResponseSpec response, String message) {
        int before = backend.getRequestCount();

        response.expectStatus().isUnauthorized()
                .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .expectBody().jsonPath("$.message").isEqualTo(message);

        assertThat(backend.getRequestCount()).isEqualTo(before);
    }

    private RecordedRequest takeForwarded() throws InterruptedException {
        RecordedRequest request = backend.takeRequest(5, TimeUnit.SECONDS);
        assertThat(request).as("la peticion deberia llegar al backend").isNotNull();
        return request;
    }

    private static String token(String subject, Date expiration) {
        return token(subject, expiration, ISSUER);
    }

    private static String token(String subject, Date expiration, String issuer) {
        var builder = Jwts.builder().signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)));
        if (issuer != null) {
            builder.issuer(issuer);
        }
        if (subject != null) {
            builder.subject(subject);
        }
        if (expiration != null) {
            builder.expiration(expiration);
        }
        return builder.compact();
    }

    private static Date inOneHour() {
        return Date.from(Instant.now().plus(1, ChronoUnit.HOURS));
    }

    private static MockWebServer startBackend() {
        MockWebServer server = new MockWebServer();
        try {
            server.start();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return server;
    }
}
