# Diagramas Arquitectónicos — GeoPicto

Este directorio organiza las vistas arquitectónicas del proyecto en dos secciones, manteniendo los archivos originales en la raíz (`C&C view.svg`, `Deployment Structure.svg`, `Layered Structured.jpeg`, `descomposition.jpeg`) para no romper los enlaces del documento [p2_2F.md](../prototypes/p2/p2_2F.md).

---

## 1. Diagramas del Prototipo 2 corregidos ([`p2-corregidos/`](./p2-corregidos/))

Correcciones a las tres estructuras observadas en la entrega del Prototipo 2 (manteniendo la vista C&C original aprobada en [`C&C view.svg`](./C%26C%20view.svg)):

| Vista | Archivo | Corrección aplicada |
| :--- | :--- | :--- |
| **Capas** | [`p2-corregidos/Layered View.svg`](./p2-corregidos/Layered%20View.svg) | Tiers `T1–T4` con flechas `Allowed to use` hacia abajo, subarquitecturas internas por componente/patrón (`Context/Hooks`, `SSR`, `Layered REST`, `Layered GraphQL`, `Layered event_driven`) y caja limpia `Data`. |
| **Despliegue** | [`p2-corregidos/Deployment View.svg`](./p2-corregidos/Deployment%20View.svg) | Elementos de software externos conectados con flechas `Deployed_in` a cada `Execution Environment` dentro de los 24 contenedores en el nodo Host, diferenciando puertos expuestos (`8081`, `8082`, `8080`, `8025`) de internos y volúmenes nombrados. |
| **Descomposición** | [`p2-corregidos/Decomposition View.svg`](./p2-corregidos/Decomposition%20View.svg) | Árbol funcional (`Root` → `Modules` → `SubModules` → `Functionalities` con relación `Is part of`) sin mezclar infraestructura técnica ni motores de bases de datos. |

---

## 2. Diagramas nuevos del Prototipo 3 ([`p3/`](./p3/))

Vistas actualizadas para la Entrega 3 incorporando los **5 escenarios de seguridad** (*Secure Channel TLS*, *Reverse Proxy Nginx*, *Network Segmentation*, *Rate Limiting* y *Distributed Token Revocation Blacklist* en Redis):

| Vista | Archivo | Novedades de Entrega 3 |
| :--- | :--- | :--- |
| **Componentes y Conectores (C&C)** | [`p3/C&C View P3.svg`](./p3/C%26C%20View%20P3.svg) | Añade `reverse-proxy` (HTTPS/WSS `:443`) al frente de frontends y `api-gateway`, más los conectores RESP de `api-gateway` y `auth` hacia `redis` (Rate Limit y Token Blacklist). |
| **Capas** | [`p3/Layered View P3.svg`](./p3/Layered%20View%20P3.svg) | `T2` (`Connection & Edge Security`) incorpora `reverse-proxy` y los filtros de Rate Limiting / JWT Blacklist en `api-gateway`, además de la dependencia documentada `T2 → T4` hacia `redis`. |
| **Despliegue** | [`p3/Deployment View P3.svg`](./p3/Deployment%20View%20P3.svg) | **25 contenedores** (`reverse-proxy` como único servicio con puertos expuestos `:80` y `:443`) y topología de **redes segmentadas (`internal: true`)**: `edge_net`, `gateway_net`, `broker_net` y 8 redes aisladas de datos (`*_db_net` / `*_data_net`). |
| **Descomposición** | [`p3/Decomposition View P3.svg`](./p3/Decomposition%20View%20P3.svg) | Añade el módulo **`Seguridad Perimetral y Control`** (`reverse-proxy` y `api-gateway`) y actualiza `auth` (revocación en Redis) y `Presentación` (HTTPS/WSS y cookies `Secure`). |
