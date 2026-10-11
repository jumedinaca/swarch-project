package com.geopicto.gateway.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class JwtServiceTests {

    @Test
    void refusesMissingSecret() {
        assertThatThrownBy(() -> new JwtService(""))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("JWT_SECRET no esta definido");
    }

    @Test
    void refusesShortSecret() {
        assertThatThrownBy(() -> new JwtService("too-short"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("al menos 32 bytes");
    }

    @Test
    void acceptsSecretOfAtLeast32Bytes() {
        assertThatCode(() -> new JwtService("x".repeat(32))).doesNotThrowAnyException();
    }
}
