package com.geopicto.gateway.revocation;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.geopicto.gateway.security.TokenClaims;

import reactor.core.publisher.Mono;

/** Blacklist en memoria para pruebas, con la misma semantica que Redis. */
public class InMemoryTokenRevocationChecker implements TokenRevocationChecker {

    private final Set<String> revoked = ConcurrentHashMap.newKeySet();
    private volatile boolean failing;

    public void revokeSession(java.util.UUID sessionId) {
        revoked.add("sid:" + sessionId);
    }

    public void revokeToken(String tokenId) {
        revoked.add("jti:" + tokenId);
    }

    public void reset() {
        revoked.clear();
        failing = false;
    }

    /** Simula que Redis no responde. */
    public void setFailing(boolean failing) {
        this.failing = failing;
    }

    @Override
    public Mono<Boolean> isRevoked(TokenClaims claims) {
        if (failing) {
            return Mono.error(new IllegalStateException("Redis no disponible (simulado)"));
        }
        boolean sessionRevoked = claims.sessionId() != null
                && revoked.contains("sid:" + claims.sessionId());
        boolean tokenRevoked = claims.tokenId() != null
                && revoked.contains("jti:" + claims.tokenId());
        return Mono.just(sessionRevoked || tokenRevoked);
    }
}
