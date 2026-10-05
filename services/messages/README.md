# Servicio de mensajes

## Propósito y estado

Este componente proporciona la API para publicar mensajes asociados a coordenadas y consultar los que se encuentran dentro de un radio geográfico. La implementación disponible está escrita en Go y persiste los mensajes en PostgreSQL con PostGIS.

El código se organiza en estas capas:

- `cmd/api`: carga de configuración, migraciones, dependencias y rutas HTTP.
- `internal/handler`: manejo de solicitudes y respuestas HTTP.
- `internal/service`: reglas y validaciones del servicio.
- `internal/repository`: operaciones de persistencia y consultas espaciales.
- `internal/domain` y `internal/schema`: entidad de dominio y estructuras de solicitudes.
- `db/migrations`: esquema de base de datos versionado.

La tabla `messages` guarda el UUID del mensaje, el UUID del emisor, el contenido, una ubicación `GEOGRAPHY(Point, 4326)` y la fecha de creación. Hay índices para ubicación, fecha y emisor. La búsqueda por proximidad usa metros y ordena los resultados desde el más cercano.

## Ejecución con Docker Compose

Desde este directorio, crea `.env` usando la configuración de ejemplo y arranca la API y la base de datos:

```powershell
Copy-Item .example.env .env
docker compose up --build
```

La API queda publicada en `http://localhost:8100`. El contenedor ejecuta las migraciones pendientes al iniciar. La base de datos del Compose usa PostGIS.

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sí | Sin valor | Cadena de conexión PostgreSQL. El ejemplo usa el servicio `messages-db`. |
| `PORT` | No | `8080` | Puerto HTTP dentro del contenedor. |

## API HTTP

Las rutas registradas por el servicio son:

| Método y ruta | Descripción | Entrada |
| --- | --- | --- |
| `POST /messages` | Crea un mensaje. Responde `201` con el mensaje creado. | Encabezado `X-User-ID` con UUID; JSON con `content`, `latitude` y `longitude`. |
| `GET /messages/{id}` | Consulta un mensaje por UUID, únicamente si pertenece al usuario indicado. | Encabezado `X-User-ID` con UUID. |
| `DELETE /messages/{id}` | Elimina un mensaje del usuario indicado. Responde `200` sin cuerpo. | Encabezado `X-User-ID` con UUID. |
| `GET /messages/nearby` | Devuelve mensajes dentro del radio, ordenados por distancia. | JSON con `latitude`, `longitude` y `radius` en metros. |

Ejemplo para crear un mensaje:

```http
POST /messages
X-User-ID: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "content": "Mensaje de ejemplo",
  "latitude": 40.4168,
  "longitude": -3.7038
}
```

Ejemplo para buscar mensajes cercanos:

```http
GET /messages/nearby
Content-Type: application/json

{
  "latitude": 40.4168,
  "longitude": -3.7038,
  "radius": 500
}
```

La respuesta de un mensaje contiene `id`, `sender_id`, `content`, `location` (con `latitude` y `longitude`) y `created_at`. La búsqueda cercana devuelve una lista con esos mismos objetos.

### Validaciones y consideraciones

- La creación rechaza contenido vacío.
- La búsqueda cercana comprueba que la latitud esté entre `-90` y `90`, la longitud entre `-180` y `180`, y que el radio sea mayor que cero.
- Los errores se responden como texto plano. Los UUID inválidos del mensaje generan `400`; la falta de un `X-User-ID` válido genera `401` en las operaciones que lo requieren.
- `X-User-ID` se acepta como identificador enviado en la solicitud; este componente no implementa ni verifica autenticación por sí mismo.
- La ruta de búsqueda está registrada como `GET` y lee sus parámetros desde el cuerpo JSON. Algunos clientes, proxies o intermediarios no manejan de forma fiable cuerpos en solicitudes `GET`.

## Alcance documentado

Este README describe exclusivamente el componente `messages` y el comportamiento observable en su código. El objetivo funcional compartido para el proyecto es publicar mensajes con ubicación y permitir su consulta por proximidad. El Excel de requisitos iniciales no está disponible como archivo legible en el workspace, por lo que todavía no se incluye una matriz de trazabilidad requisito por requisito.