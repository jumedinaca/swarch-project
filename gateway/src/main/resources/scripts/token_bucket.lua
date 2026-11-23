-- Token Bucket atomico para el Rate Limiting del gateway.
--
-- Cada cliente (IP o usuario) tiene un "balde" con hasta `capacity` fichas.
-- Cada peticion consume una ficha y el balde se rellena a razon de
-- `refill_tokens` fichas cada `refill_ms` milisegundos. Sin fichas -> 429.
--
-- Al ejecutarse como script, Redis lo corre de forma atomica: varias
-- instancias del gateway pueden compartir el mismo balde sin condiciones de
-- carrera. El reloj es el de Redis (TIME), asi que no depende de que los
-- relojes de las instancias del gateway esten sincronizados.
--
-- KEYS[1] = clave del balde, p. ej. "rl:auth:ip:203.0.113.7"
-- ARGV[1] = capacity, ARGV[2] = refill_tokens, ARGV[3] = refill_ms
--
-- Devuelve {permitido (1/0), fichas restantes, ms hasta la proxima ficha}

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_tokens = tonumber(ARGV[2])
local refill_ms = tonumber(ARGV[3])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local last = tonumber(state[2])
if tokens == nil or last == nil then
  tokens = capacity
  last = now
end

local rate = refill_tokens / refill_ms -- fichas por milisegundo
local elapsed = math.max(0, now - last)
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
local retry_ms = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_ms = math.ceil((1 - tokens) / rate)
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
-- La clave expira cuando el balde estaria lleno de nuevo: no deja basura.
redis.call('PEXPIRE', key, math.ceil(capacity / rate) + 1000)

return { allowed, math.floor(tokens), retry_ms }
