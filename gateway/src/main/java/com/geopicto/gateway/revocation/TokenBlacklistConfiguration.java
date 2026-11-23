package com.geopicto.gateway.revocation;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(TokenBlacklistProperties.class)
public class TokenBlacklistConfiguration {
}
