package com.geopicto.gateway.ratelimit;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import reactor.core.publisher.Mono;

/** Mismo algoritmo que scripts/token_bucket.lua, en memoria, para pruebas sin Redis. */
public class InMemoryTokenBucketLimiter implements TokenBucketLimiter {

    private record Bucket(double tokens, long timestampMillis) {
    }

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();
    private volatile boolean failing;

    public void reset() {
        buckets.clear();
        failing = false;
    }

    /** Simula que Redis no responde. */
    public void setFailing(boolean failing) {
        this.failing = failing;
    }

    @Override
    public Mono<Decision> tryConsume(String key, RateLimitProperties.Policy policy) {
        if (failing) {
            return Mono.error(new IllegalStateException("Redis no disponible (simulado)"));
        }

        long now = System.currentTimeMillis();
        double rate = (double) policy.getRefillTokens() / policy.getRefillPeriod().toMillis();
        Decision[] decision = new Decision[1];

        buckets.compute(key, (k, bucket) -> {
            double tokens = bucket == null ? policy.getCapacity()
                    : Math.min(policy.getCapacity(),
                            bucket.tokens() + Math.max(0, now - bucket.timestampMillis()) * rate);
            if (tokens >= 1) {
                tokens -= 1;
                decision[0] = new Decision(true, (long) tokens, 0);
            } else {
                decision[0] = new Decision(false, (long) tokens, (long) Math.ceil((1 - tokens) / rate));
            }
            return new Bucket(tokens, now);
        });

        return Mono.just(decision[0]);
    }
}
