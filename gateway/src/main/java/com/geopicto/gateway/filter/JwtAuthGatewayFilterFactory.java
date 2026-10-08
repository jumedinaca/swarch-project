package com.geopicto.gateway.filter;

import java.nio.charset.StandardCharsets;

import org.springframework.cloud.gateway.filter.GatewayFilter;
import org.springframework.cloud.gateway.filter.factory.AbstractGatewayFilterFactory;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;

import com.geopicto.gateway.security.JwtService;

import io.jsonwebtoken.JwtException;
import reactor.core.publisher.Mono;

/**
 * Filtro de ruta "JwtAuth": exige un header "Authorization: Bearer <token>"
 * valido, y si lo es, lo reemplaza por un header "X-User-ID" con el claim
 * "sub" del token antes de reenviar la peticion al microservicio interno.
 * Se usa agregando "- JwtAuth" a los filters de una ruta en application.yml.
 */
@Component
public class JwtAuthGatewayFilterFactory extends AbstractGatewayFilterFactory<Object> {

    private final JwtService jwtService;

    public JwtAuthGatewayFilterFactory(JwtService jwtService) {
        super(Object.class);
        this.jwtService = jwtService;
    }

    @Override
    public GatewayFilter apply(Object config) {
        return (exchange, chain) -> {
            String authHeader = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);

            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                return reject(exchange, "Missing or invalid Authorization header");
            }

            String token = authHeader.substring("Bearer ".length());

            String userId;
            try {
                userId = jwtService.extractUserId(token);
            } catch (JwtException | IllegalArgumentException e) {
                return reject(exchange, "Invalid or expired token");
            }

            ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                    .headers(headers -> {
                        headers.remove(HttpHeaders.AUTHORIZATION);
                        headers.set("X-User-ID", userId);
                    })
                    .build();

            return chain.filter(exchange.mutate().request(mutatedRequest).build());
        };
    }

    private Mono<Void> reject(ServerWebExchange exchange, String message) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        response.getHeaders().setContentType(org.springframework.http.MediaType.TEXT_PLAIN);

        DataBuffer buffer = response.bufferFactory().wrap(message.getBytes(StandardCharsets.UTF_8));
        return response.writeWith(Mono.just(buffer));
    }
}
