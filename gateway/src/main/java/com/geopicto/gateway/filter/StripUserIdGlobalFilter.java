package com.geopicto.gateway.filter;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;

import reactor.core.publisher.Mono;

/**
 * Elimina cualquier "X-User-ID" o "X-Internal-Token" enviado por el cliente en
 * todas las rutas. Los servicios internos confian en esos headers, asi que solo
 * el filtro JwtAuth (que corre despues) puede inyectar X-User-ID a partir de un
 * token valido, y X-Internal-Token nunca debe aceptarse desde el exterior.
 */
@Component
public class StripUserIdGlobalFilter implements GlobalFilter, Ordered {

    public static final String USER_ID_HEADER = "X-User-ID";
    public static final String INTERNAL_TOKEN_HEADER = "X-Internal-Token";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        var headers = exchange.getRequest().getHeaders();
        boolean hasUserId = headers.containsHeader(USER_ID_HEADER);
        boolean hasInternalToken = headers.containsHeader(INTERNAL_TOKEN_HEADER);
        if (!hasUserId && !hasInternalToken) {
            return chain.filter(exchange);
        }

        ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(mutableHeaders -> {
                    mutableHeaders.remove(USER_ID_HEADER);
                    mutableHeaders.remove(INTERNAL_TOKEN_HEADER);
                })
                .build();

        return chain.filter(exchange.mutate().request(request).build());
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
