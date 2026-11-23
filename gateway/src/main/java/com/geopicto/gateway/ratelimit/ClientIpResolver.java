package com.geopicto.gateway.ratelimit;

import java.net.InetSocketAddress;

import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;

/**
 * Obtiene la IP del cliente. Detras del Reverse Proxy la conexion TCP viene
 * del proxy, por lo que (si se confia en el) se usan las cabeceras que este pone:
 * X-Real-IP, o el ultimo elemento de X-Forwarded-For (el que agrega el proxy;
 * los anteriores los puede inventar el cliente).
 */
@Component
public class ClientIpResolver {

    private final RateLimitProperties properties;

    public ClientIpResolver(RateLimitProperties properties) {
        this.properties = properties;
    }

    public String resolve(ServerHttpRequest request) {
        if (properties.isTrustForwardedHeaders()) {
            String realIp = request.getHeaders().getFirst("X-Real-IP");
            if (realIp != null && !realIp.isBlank()) {
                return realIp.trim();
            }

            String forwardedFor = request.getHeaders().getFirst("X-Forwarded-For");
            if (forwardedFor != null && !forwardedFor.isBlank()) {
                String[] hops = forwardedFor.split(",");
                String last = hops[hops.length - 1].trim();
                if (!last.isEmpty()) {
                    return last;
                }
            }
        }

        InetSocketAddress remote = request.getRemoteAddress();
        if (remote == null || remote.getAddress() == null) {
            return "unknown";
        }
        return remote.getAddress().getHostAddress();
    }
}
