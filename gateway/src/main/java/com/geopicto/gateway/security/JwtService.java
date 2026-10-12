package com.geopicto.gateway.security;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import javax.crypto.SecretKey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/**
 * Valida los JWT emitidos por el microservicio de autenticacion y extrae el
 * identificador del usuario (claim "sub") para propagarlo a los servicios
 * internos. El secreto debe coincidir con el que use ese microservicio para
 * firmar los tokens (HS256, por lo que requiere al menos 32 bytes).
 * El contrato completo esta en docs/jwt-contract.md.
 */
@Component
public class JwtService {

    static final int MIN_SECRET_BYTES = 32;

    private final SecretKey key;
    private final String issuer;

    public JwtService(@Value("${jwt.secret}") String secret, @Value("${jwt.issuer}") String issuer) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "JWT_SECRET no esta definido. El gateway no arranca sin un secreto para verificar los JWT.");
        }

        byte[] secretBytes = secret.getBytes(StandardCharsets.UTF_8);
        if (secretBytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                    "JWT_SECRET debe tener al menos " + MIN_SECRET_BYTES + " bytes (HS256).");
        }

        if (issuer == null || issuer.isBlank()) {
            throw new IllegalStateException("JWT_ISSUER no puede estar vacio.");
        }

        this.key = Keys.hmacShaKeyFor(secretBytes);
        this.issuer = issuer;
    }

    /**
     * @throws JwtException si el token esta mal formado, expirado, la firma no es
     *                      valida, su "iss" no es el esperado, no tiene "exp" o
     *                      su "sub" no es un UUID.
     */
    public UUID extractUserId(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(key)
                .requireIssuer(issuer)
                .build()
                .parseSignedClaims(token)
                .getPayload();

        if (claims.getExpiration() == null) {
            throw new JwtException("Token sin claim exp");
        }

        String subject = claims.getSubject();
        if (subject == null || subject.isBlank()) {
            throw new JwtException("Token sin claim sub");
        }

        try {
            return UUID.fromString(subject);
        } catch (IllegalArgumentException e) {
            throw new JwtException("El claim sub no es un UUID", e);
        }
    }
}
