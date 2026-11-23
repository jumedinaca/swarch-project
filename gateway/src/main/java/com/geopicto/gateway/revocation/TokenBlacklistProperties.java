package com.geopicto.gateway.revocation;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuracion de la blacklist de tokens revocados (prefijo "token-blacklist"
 * en application.yml). El servicio de autenticacion escribe en las mismas
 * claves de Redis; por eso ambos comparten el prefijo y el interruptor.
 */
@ConfigurationProperties(prefix = "token-blacklist")
public class TokenBlacklistProperties {

    /**
     * Interruptor global del patron. Con false el gateway no consulta Redis y
     * el servicio de auth no escribe la revocacion: el access token sigue
     * sirviendo hasta expirar (modo para demostrar la vulnerabilidad).
     */
    private boolean enabled = true;

    /**
     * Si Redis no responde: true deja pasar la peticion (prioriza
     * disponibilidad), false responde 503 (prioriza la seguridad).
     */
    private boolean failOpen = true;

    /** Tiempo maximo de espera a Redis por peticion. */
    private Duration redisTimeout = Duration.ofMillis(500);

    /** Prefijo compartido con services/auth. Debe ser identico en ambos. */
    private String keyPrefix = "auth:revoked:";

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

    public Duration getRedisTimeout() {
        return redisTimeout;
    }

    public void setRedisTimeout(Duration redisTimeout) {
        this.redisTimeout = redisTimeout;
    }

    public String getKeyPrefix() {
        return keyPrefix;
    }

    public void setKeyPrefix(String keyPrefix) {
        this.keyPrefix = keyPrefix;
    }
}
