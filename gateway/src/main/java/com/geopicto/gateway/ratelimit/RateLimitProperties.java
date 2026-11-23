package com.geopicto.gateway.ratelimit;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuracion del Rate Limiting (prefijo "rate-limit" en application.yml).
 * Cada ruta referencia una politica por nombre con el filtro "RateLimit=<politica>".
 */
@ConfigurationProperties(prefix = "rate-limit")
public class RateLimitProperties {

    /** Interruptor global; las pruebas de rendimiento pueden apagarlo con RATE_LIMIT_ENABLED=false. */
    private boolean enabled = true;

    /**
     * Si Redis no responde: true deja pasar la peticion (prioriza disponibilidad),
     * false responde 503 (prioriza la proteccion).
     */
    private boolean failOpen = true;

    /**
     * Usar X-Real-IP / X-Forwarded-For para identificar al cliente. Solo debe
     * activarse cuando el gateway es alcanzable unicamente a traves del Reverse
     * Proxy; si no, un atacante podria falsificar su IP con esas cabeceras.
     */
    private boolean trustForwardedHeaders = false;

    /** Tiempo maximo de espera a Redis por peticion. */
    private Duration redisTimeout = Duration.ofMillis(500);

    private Map<String, Policy> policies = new LinkedHashMap<>();

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isFailOpen() {
        return failOpen;
    }

    public void setFailOpen(boolean failOpen) {
        this.failOpen = failOpen;
    }

    public boolean isTrustForwardedHeaders() {
        return trustForwardedHeaders;
    }

    public void setTrustForwardedHeaders(boolean trustForwardedHeaders) {
        this.trustForwardedHeaders = trustForwardedHeaders;
    }

    public Duration getRedisTimeout() {
        return redisTimeout;
    }

    public void setRedisTimeout(Duration redisTimeout) {
        this.redisTimeout = redisTimeout;
    }

    public Map<String, Policy> getPolicies() {
        return policies;
    }

    public void setPolicies(Map<String, Policy> policies) {
        this.policies = policies;
    }

    /** Como se identifica al cliente que consume fichas. */
    public enum KeyType {
        /** Por direccion IP: rutas publicas (login, registro, nearby). */
        IP,
        /** Por usuario autenticado (claim "sub" del JWT); si no hay, cae a IP. */
        USER
    }

    /** Un Token Bucket: hasta {@code capacity} peticiones seguidas y {@code refillTokens} nuevas cada {@code refillPeriod}. */
    public static class Policy {

        private int capacity;
        private int refillTokens;
        private Duration refillPeriod;
        private KeyType key = KeyType.IP;

        public void validate(String name) {
            if (capacity < 1 || refillTokens < 1 || refillPeriod == null || refillPeriod.toMillis() < 1) {
                throw new IllegalStateException("Politica de rate limit '" + name
                        + "' invalida: capacity y refill-tokens deben ser >= 1 y refill-period > 0");
            }
        }

        public int getCapacity() {
            return capacity;
        }

        public void setCapacity(int capacity) {
            this.capacity = capacity;
        }

        public int getRefillTokens() {
            return refillTokens;
        }

        public void setRefillTokens(int refillTokens) {
            this.refillTokens = refillTokens;
        }

        public Duration getRefillPeriod() {
            return refillPeriod;
        }

        public void setRefillPeriod(Duration refillPeriod) {
            this.refillPeriod = refillPeriod;
        }

        public KeyType getKey() {
            return key;
        }

        public void setKey(KeyType key) {
            this.key = key;
        }
    }
}
