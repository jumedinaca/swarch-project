package com.geopicto.gateway.filter;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;

import reactor.core.publisher.Mono;

/**
 * Elimina cualquier "X-User-ID" enviado por el cliente en todas las rutas.
 * Los servicios internos confian en ese header, asi que solo el filtro JwtAuth
 * (que corre despues) puede ponerlo, a partir de un token valido.
 */
@Component
public class StripUserIdGlobalFilter implements GlobalFilter, Ordered {

    public static final String USER_ID_HEADER = "X-User-ID";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        if (!exchange.getRequest().getHeaders().containsHeader(USER_ID_HEADER)) {
            return chain.filter(exchange);
        }

        ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(headers -> headers.remove(USER_ID_HEADER))
                .build();

        return chain.filter(exchange.mutate().request(request).build());
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
