package com.geopicto.gateway.ratelimit;

import reactor.core.publisher.Mono;

/** Almacen de baldes (Token Bucket) compartido por todas las instancias del gateway. */
public interface TokenBucketLimiter {

    /** Intenta consumir una ficha del balde {@code key} segun {@code policy}. */
    Mono<Decision> tryConsume(String key, RateLimitProperties.Policy policy);

    /**
     * @param allowed          si la peticion puede continuar
     * @param remaining        fichas que quedan en el balde
     * @param retryAfterMillis cuando no se permite, ms hasta que haya una ficha nueva
     */
    record Decision(boolean allowed, long remaining, long retryAfterMillis) {
    }
}
