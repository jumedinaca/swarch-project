package com.geopicto.gateway.filter;

import java.util.UUID;

import org.springframework.cloud.gateway.filter.GatewayFilter;
import org.springframework.cloud.gateway.filter.factory.AbstractGatewayFilterFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;

import com.geopicto.gateway.security.JwtService;

import io.jsonwebtoken.JwtException;

/**
 * Filtro de ruta "JwtAuth": exige un header "Authorization: Bearer <token>"
 * valido, agrega un header "X-User-ID" con el claim "sub" y reenvia tambien
 * el Authorization al microservicio interno, que vuelve a verificar el JWT.
 * Se usa agregando "- JwtAuth" a los filters de una ruta en application.yml.
 */
@Component
public class JwtAuthGatewayFilterFactory extends AbstractGatewayFilterFactory<Object> {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;

    public JwtAuthGatewayFilterFactory(JwtService jwtService) {
        super(Object.class);
        this.jwtService = jwtService;
    }

    @Override
    public GatewayFilter apply(Object config) {
        return (exchange, chain) -> {
            String authHeader = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);

            if (authHeader == null || !authHeader.startsWith(BEARER_PREFIX)) {
                return ErrorResponses.write(exchange, HttpStatus.UNAUTHORIZED,
                        "Missing or invalid Authorization header");
            }

            String token = authHeader.substring(BEARER_PREFIX.length());

            UUID userId;
            try {
                userId = jwtService.extractUserId(token);
            } catch (JwtException | IllegalArgumentException e) {
                return ErrorResponses.write(exchange, HttpStatus.UNAUTHORIZED, "Invalid or expired token");
            }

            // Se conserva Authorization: los servicios internos validan el JWT
            // por su cuenta (defensa en profundidad) y ademas reciben X-User-ID.
            ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                    .headers(headers -> headers.set(
                            StripUserIdGlobalFilter.USER_ID_HEADER, userId.toString()))
                    .build();

            return chain.filter(exchange.mutate().request(mutatedRequest).build());
        };
    }
}
