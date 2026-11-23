package com.geopicto.gateway.security;

import java.time.Instant;
import java.util.UUID;

/**
 * Claims del access token que necesita el gateway. Ademas de identificar al
 * usuario ("sub"), incluye "sid" y "jti" para consultar la blacklist de
 * revocacion (Escenario 5) y "exp" para conocer la ventana de revocacion.
 *
 * <p>"sid" y "jti" son opcionales para no romper tokens de desarrollo antiguos
 * (scripts/dev-token.mjs). Los tokens emitidos por services/auth siempre los
 * incluyen.
 */
public record TokenClaims(UUID userId, UUID sessionId, String tokenId, Instant expiresAt) {
}
