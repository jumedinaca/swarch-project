package com.geopicto.gateway.filter;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilter;
import org.springframework.cloud.gateway.filter.factory.AbstractGatewayFilterFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;

import com.geopicto.gateway.ratelimit.ClientIpResolver;
import com.geopicto.gateway.ratelimit.RateLimitProperties;
import com.geopicto.gateway.ratelimit.RateLimitProperties.KeyType;
import com.geopicto.gateway.ratelimit.RateLimitProperties.Policy;
import com.geopicto.gateway.ratelimit.TokenBucketLimiter;
import com.geopicto.gateway.ratelimit.TokenBucketLimiter.Decision;

import reactor.core.publisher.Mono;

/**
 * Filtro de ruta "RateLimit=<politica>" (Rate Limiting / Throttling Pattern).
 * Aplica un Token Bucket en Redis por cliente; al agotarse responde
 * 429 Too Many Requests con Retry-After, sin llegar al microservicio.
 *
 * <p>En rutas con JWT debe ir despues de JwtAuth: asi la clave por usuario
 * sale del X-User-ID que ese filtro deriva de un token valido.
 */
@Component
public class RateLimitGatewayFilterFactory
        extends AbstractGatewayFilterFactory<RateLimitGatewayFilterFactory.Config> {

    public static final String LIMIT_HEADER = "X-RateLimit-Limit";
    public static final String REMAINING_HEADER = "X-RateLimit-Remaining";

    private static final Logger log = LoggerFactory.getLogger(RateLimitGatewayFilterFactory.class);

    private final TokenBucketLimiter limiter;
    private final ClientIpResolver ipResolver;
    private final RateLimitProperties properties;

    public RateLimitGatewayFilterFactory(TokenBucketLimiter limiter, ClientIpResolver ipResolver,
            RateLimitProperties properties) {
        super(Config.class);
        this.limiter = limiter;
        this.ipResolver = ipResolver;
        this.properties = properties;
    }

    @Override
    public List<String> shortcutFieldOrder() {
        return List.of("policy");
    }

    @Override
    public GatewayFilter apply(Config config) {
        String policyName = config.getPolicy();
        Policy policy = properties.getPolicies().get(policyName);
        if (policy == null) {
            throw new IllegalArgumentException("Politica de rate limit desconocida: " + policyName);
        }

        return (exchange, chain) -> {
            if (!properties.isEnabled() || exchange.getRequest().getMethod() == HttpMethod.OPTIONS) {
                return chain.filter(exchange);
            }

            String key = "rl:" + policyName + ":" + clientKey(exchange.getRequest(), policy.getKey());

            return limiter.tryConsume(key, policy)
                    .timeout(properties.getRedisTimeout())
                    .map(decision -> (Object) decision)
                    .onErrorResume(error -> {
                        log.warn("Rate limit no disponible (Redis): {}", error.toString());
                        return Mono.just(Unavailable.INSTANCE);
                    })
                    .flatMap(result -> {
                        if (result instanceof Decision decision) {
                            HttpHeaders headers = exchange.getResponse().getHeaders();
                            headers.set(LIMIT_HEADER, Integer.toString(policy.getCapacity()));
                            headers.set(REMAINING_HEADER, Long.toString(decision.remaining()));
                            if (decision.allowed()) {
                                return chain.filter(exchange);
                            }
                            long seconds = Math.max(1, (decision.retryAfterMillis() + 999) / 1000);
                            headers.set(HttpHeaders.RETRY_AFTER, Long.toString(seconds));
                            return ErrorResponses.write(exchange, HttpStatus.TOO_MANY_REQUESTS,
                                    "Too many requests, retry in " + seconds + " s");
                        }
                        if (properties.isFailOpen()) {
                            return chain.filter(exchange);
                        }
                        return ErrorResponses.write(exchange, HttpStatus.SERVICE_UNAVAILABLE,
                                "Rate limiter unavailable");
                    });
        };
    }

    private String clientKey(ServerHttpRequest request, KeyType type) {
        if (type == KeyType.USER) {
            String userId = request.getHeaders().getFirst(StripUserIdGlobalFilter.USER_ID_HEADER);
            if (userId != null && !userId.isBlank()) {
                return "user:" + userId;
            }
        }
        return "ip:" + ipResolver.resolve(request);
    }

    /** Marca de "Redis fallo" para distinguirla de una decision real. */
    private enum Unavailable {
        INSTANCE
    }

    public static class Config {

        private String policy;

        public String getPolicy() {
            return policy;
        }

        public void setPolicy(String policy) {
            this.policy = policy;
        }
    }
}
