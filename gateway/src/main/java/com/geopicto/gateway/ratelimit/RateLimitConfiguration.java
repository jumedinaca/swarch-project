package com.geopicto.gateway.ratelimit;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(RateLimitProperties.class)
public class RateLimitConfiguration {

    public RateLimitConfiguration(RateLimitProperties properties) {
        // Falla al arrancar si una politica esta mal configurada.
        properties.getPolicies().forEach((name, policy) -> policy.validate(name));
    }
}
