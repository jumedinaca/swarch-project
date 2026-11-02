# ==========================================
# Etapa 1: Build (Elixir 1.18 + OTP 27)
# ==========================================
FROM hexpm/elixir:1.18.2-erlang-27.2.4-alpine-3.21.3 AS builder

RUN apk add --no-cache build-base git

WORKDIR /app

ENV MIX_ENV=prod

RUN mix local.hex --force && \
    mix local.rebar --force

COPY mix.exs ./
RUN mix deps.get --only $MIX_ENV && \
    mix deps.compile

COPY config config
COPY lib lib

RUN mix compile && \
    mix release

# ==========================================
# Etapa 2: Runtime ligero
# ==========================================
FROM alpine:3.21.3

RUN apk add --no-cache libstdc++ openssl ncurses-libs wget && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /app/_build/prod/rel/realtime ./

USER appuser

ENV PORT=8080
EXPOSE 8080

CMD ["/app/bin/realtime", "start"]
