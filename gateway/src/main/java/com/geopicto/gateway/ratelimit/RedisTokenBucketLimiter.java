package com.geopicto.gateway.ratelimit;

import java.util.List;

import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import reactor.core.publisher.Mono;

/** Token Bucket en Redis: ejecuta scripts/token_bucket.lua de forma atomica. */
@Component
public class RedisTokenBucketLimiter implements TokenBucketLimiter {

    @SuppressWarnings("rawtypes")
    private static final RedisScript<List> SCRIPT =
            RedisScript.of(new ClassPathResource("scripts/token_bucket.lua"), List.class);

    private final ReactiveStringRedisTemplate redis;

    public RedisTokenBucketLimiter(ReactiveStringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public Mono<Decision> tryConsume(String key, RateLimitProperties.Policy policy) {
        List<String> args = List.of(
                Integer.toString(policy.getCapacity()),
                Integer.toString(policy.getRefillTokens()),
                Long.toString(policy.getRefillPeriod().toMillis()));

        return redis.execute(SCRIPT, List.of(key), args)
                .next()
                .map(result -> new Decision(
                        toLong(result.get(0)) == 1L,
                        toLong(result.get(1)),
                        toLong(result.get(2))));
    }

    private static long toLong(Object value) {
        return ((Number) value).longValue();
    }
}
