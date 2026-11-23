package com.geopicto.gateway.revocation;

import com.geopicto.gateway.security.TokenClaims;

import reactor.core.publisher.Mono;

/**
 * Consulta si un access token fue revocado (Escenario 5). La implementacion
 * distribuida usa Redis; las pruebas la reemplazan por una version en memoria.
 */
public interface TokenRevocationChecker {

    /**
     * @return {@code true} si el token debe rechazarse con 401.
     */
    Mono<Boolean> isRevoked(TokenClaims claims);
}
