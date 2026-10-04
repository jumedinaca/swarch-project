-- 1. Eliminar los índices
DROP INDEX IF EXISTS idx_messages_sender;
DROP INDEX IF EXISTS idx_messages_created_at;
DROP INDEX IF EXISTS idx_messages_location;

-- 2. Eliminar la tabla
DROP TABLE IF EXISTS messages;

-- 3. Eliminar la extensión PostGIS (Opcional)
-- Nota: Ten precaución en entornos compartidos, ya que si otras tablas usan PostGIS esta sentencia fallará o afectará a esas tablas.
DROP EXTENSION IF EXISTS postgis;