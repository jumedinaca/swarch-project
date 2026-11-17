-- Datos semilla idempotentes para Laboratory 6 (Performance Tests)
-- Inserta 100 mensajes geolocalizados en estado PUBLISHED alrededor de la
-- Plaza Che (Universidad Nacional de Colombia, Bogota: 4.6371, -74.0834)
-- para que GET /api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500
-- ejecute consultas espaciales PostGIS (ST_DWithin + ST_Distance) reales.

DELETE FROM messages WHERE moderation_reason = 'LAB6_SEED';

INSERT INTO messages (
    id,
    sender_id,
    content,
    location,
    status,
    moderation_status,
    moderation_reason,
    version,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111'::uuid,
    format('Mensaje geolocalizado de prueba #%s en campus UNAL (Lab 6 Performance)', i),
    ST_SetSRID(
        ST_MakePoint(
            -74.0834 + (((i % 10) - 5) * 0.00018),
            4.6371   + (((i / 10) - 5) * 0.00018)
        ),
        4326
    )::geography,
    'PUBLISHED',
    'ALLOW',
    'LAB6_SEED',
    1,
    now() - (i || ' minutes')::interval,
    now() - (i || ' minutes')::interval
FROM generate_series(1, 100) AS s(i);
