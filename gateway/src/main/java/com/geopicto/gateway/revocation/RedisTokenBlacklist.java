package com.geopicto.gateway.revocation;

import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;

import com.geopicto.gateway.security.TokenClaims;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Token Revocation Blacklist Pattern (Escenario 5).
 *
 * <p>El servicio de autenticacion escribe en Redis una clave por cada sesion
 * revocada: {@code auth:revoked:sid:<sid>} con un TTL igual al tiempo que le
 * queda al access token. Antes de reenviar una peticion protegida, el gateway
 * consulta esa clave (y opcionalmente {@code auth:revoked:jti:<jti>}) y
 * responde 401 si existe.
 *
 * <p>Si Redis falla, el comportamiento lo decide {@code fail-open}: por
 * defecto se deja pasar la peticion para no tumbar el sistema cuando el cache
 * de revocacion no esta disponible. Con {@code TOKEN_BLACKLIST_FAIL_OPEN=false}
 * el gateway responde 503 y prioriza la seguridad.
 */
@Component
public class RedisTokenBlacklist implements TokenRevocationChecker {

    private static final Logger log = LoggerFactory.getLogger(RedisTokenBlacklist.class);

    private final ReactiveStringRedisTemplate redis;
    private final TokenBlacklistProperties properties;

    public RedisTokenBlacklist(ReactiveStringRedisTemplate redis, TokenBlacklistProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public Mono<Boolean> isRevoked(TokenClaims claims) {
        if (!properties.isEnabled()) {
            return Mono.just(false);
        }

        List<String> keys = new ArrayList<>(2);
        if (claims.sessionId() != null) {
            keys.add(properties.getKeyPrefix() + "sid:" + claims.sessionId());
        }
        if (claims.tokenId() != null && !claims.tokenId().isBlank()) {
            keys.add(properties.getKeyPrefix() + "jti:" + claims.tokenId());
        }

        if (keys.isEmpty()) {
            // Tokens de desarrollo antiguos sin sid/jti: no hay nada que buscar.
            return Mono.just(false);
        }

        return Flux.fromIterable(keys)
                .concatMap(redis::hasKey)
                .any(Boolean::booleanValue)
                .defaultIfEmpty(false)
                .timeout(properties.getRedisTimeout())
                .onErrorResume(error -> {
                    log.warn("No se pudo consultar la blacklist de tokens en Redis: {}", error.toString());
                    return properties.isFailOpen() ? Mono.just(false) : Mono.error(error);
                });
    }
}
