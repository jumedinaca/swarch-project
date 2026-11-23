package com.geopicto.gateway.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;

import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;

class ClientIpResolverTests {

    private static final InetSocketAddress PROXY = new InetSocketAddress("172.18.0.5", 50000);

    @Test
    void usesSocketAddressWhenProxyIsNotTrusted() {
        var request = MockServerHttpRequest.get("/").remoteAddress(PROXY)
                .header("X-Real-IP", "1.2.3.4").header("X-Forwarded-For", "5.6.7.8").build();

        // Sin confianza en el proxy, las cabeceras se ignoran (se pueden falsificar).
        assertThat(resolver(false).resolve(request)).isEqualTo("172.18.0.5");
    }

    @Test
    void prefersXRealIpWhenProxyIsTrusted() {
        var request = MockServerHttpRequest.get("/").remoteAddress(PROXY)
                .header("X-Real-IP", "203.0.113.7").header("X-Forwarded-For", "6.6.6.6, 203.0.113.7").build();

        assertThat(resolver(true).resolve(request)).isEqualTo("203.0.113.7");
    }

    @Test
    void usesLastForwardedHopAddedByTheProxy() {
        // "6.6.6.6" lo invento el cliente; el ultimo elemento lo agrego Nginx.
        var request = MockServerHttpRequest.get("/").remoteAddress(PROXY)
                .header("X-Forwarded-For", "6.6.6.6, 203.0.113.7").build();

        assertThat(resolver(true).resolve(request)).isEqualTo("203.0.113.7");
    }

    @Test
    void fallsBackToSocketAddressWithoutHeaders() {
        var request = MockServerHttpRequest.get("/").remoteAddress(PROXY).build();

        assertThat(resolver(true).resolve(request)).isEqualTo("172.18.0.5");
    }

    private static ClientIpResolver resolver(boolean trustProxy) {
        RateLimitProperties properties = new RateLimitProperties();
        properties.setTrustForwardedHeaders(trustProxy);
        return new ClientIpResolver(properties);
    }
}
