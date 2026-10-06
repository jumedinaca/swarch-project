# GeoPicto - Componente de Presentación Móvil Geoespacial

> **Plataforma colaborativa de mensajes geoespaciales contextuales:** Sistema distribuido donde los usuarios pueden crear, descubrir y valorar mensajes asociados a ubicaciones geográficas en tiempo real.

Este repositorio contiene el **componente de presentación móvil** desarrollado en **React Native (Expo)** con aceleración WebGL 3D, edificios en 3D y teselas de **OpenStreetMap** mediante **MapLibre**, y una estética lúdica y minimalista inspirada en las interfaces de **Nintendo de la era Wii y DS (Menú Wii, PictoChat y Plaza Mii)**.

---

## 🎨 Estética de Diseño Nintendo (Wii / DS / 3DS)

La interfaz adopta fielmente los principios de diseño de las consolas de Nintendo:
- **Colores:** Fondos blancos, gris perla suave (`#F5F8F7`) y verde menta sutil (`#E6F7EF`), con toques de azul Menú Wii (`#009CD8`), verde StreetPass/Miiverse (`#2DC653`) y ámbar (`#FFA94D`).
- **Formas y Relieves:** Tarjetas y botones ultra-redondeados tipo píldora, con brillos translúcidos superiores (*glossy*) y sombras difusas de porcelana.
- **Notas PictoChat:** Las tarjetas de mensaje emulan el bloc de notas de Nintendo DS con fondo cuadriculado milimetrado, bordes oscuros limpios y tipografía redondeada y legible.

---

## 📱 Las Dos Vistas Principales

El componente se concentra estrictamente en las dos vistas solicitadas para la presentación:

### 1. Vista de Login y Registro (`AuthScreen`)
- Switch redondeado entre **Iniciar Sesión** y **Registrarse**.
- **Inicio de sesión limpio:** Ingreso con usuario o correo electrónico y contraseña.
- **Registro simplificado:** Formulario directo de usuario, correo y contraseña con asignación automática de identidad y color.

### 2. Vista de Mapa 3D MapLibre con OpenStreetMap (`MapScreen`)
- **Motor 3D MapLibre con Edificios 3D Reales:** 
  - Renderizado tridimensional con ángulo isométrico diorama (`pitch: 62°`, `bearing: -20°`).
  - Capa de **extrusión 3D de edificios** (`fill-extrusion`) basada en datos de **OpenStreetMap**, donde las construcciones se alzan verticalmente con altura real y luz direccional que genera sombras y volumen.
  - Controles 3D dedicados: recentrado, alternador de ángulo 3D/2D y rotación de cámara en 45° para explorar el entorno en 360°.
- **Marcador del Usuario:** Círculo azul celeste con halo pulsante indicando la posición actual obtenida por geolocalización.
- **Marcadores 3D tipo Billboard:** Pines con forma de bocadillo PictoChat que flotan verticalmente sobre el terreno con sombra elíptica proyectada en el plano del mapa. Tocar un pin abre el detalle del mensaje.
- **Redacción de Mensajes Exclusiva por Botón (Máximo 140 caracteres):**
  - **Solo se puede redactar mediante el botón flotante (FAB)** con icono de lápiz/stylus de Nintendo DS; hacer clic en el mapa no crea notas para evitar acciones accidentales.
  - La nota se asocia de forma automática a la ubicación actual de la persona.
  - Libreta cuadriculada con contador reactivo `[ X / 140 caracteres ]` que bloquea caracteres excedentes.
  - **Asignación automática de estado:** `publicado`, `pendiente`, `oculto` o `eliminado`.
  - **Asignación automática de expiración:** Calculada a +24 horas desde la publicación.
- **Eliminación por el Autor:** Si el usuario autenticado es el autor del mensaje, aparece el botón **"Eliminar"**, el cual actualiza el estado a `eliminado` según las reglas de negocio.
- **Filtros de Estado:** Píldoras para filtrar notas en el área por estado (`Todos`, `Publicados`, `Pendientes`, `Ocultos`).
- **Feed Inferior Plegable:** Lista de tarjetas PictoChat que se desliza desde la parte inferior de la pantalla.

---

## 🖥️ Cómo Probar la Aplicación

La aplicación está preparada para probarse cómodamente tanto desde un **computador** como desde un **teléfono celular físico**.

### Modo 1: Desde el Computador (Simulador de Celular)
Al abrir la aplicación en el navegador de tu computadora (PC o Mac en resolución de escritorio):
1. La aplicación detectará automáticamente el tamaño de pantalla y mostrará un **Simulador de Smartphone** con marco redondeado, notch de cámara, barra de estado y reflejos metálicos.
2. Puedes interactuar con la pantalla usando el cursor exactamente como si tuvieras el celular en tu mano.
3. Si deseas probar en ancho completo, puedes hacer clic en el botón superior **"Pantalla Completa"**.

### Modo 2: Desde un Celular Físico

#### Opción A: A través de la Red Local (vía Docker o Servidor Web)
1. Asegúrate de que tu celular y tu computadora estén conectados a la **misma red Wi-Fi**.
2. Averigua la dirección IP local de tu computador:
   - **En macOS:** Abre la terminal y ejecuta `ipconfig getifaddr en0` (o `en1`).
   - **En Linux:** `hostname -I`.
   - **En Windows:** `ipconfig` en CMD (Dirección IPv4).
3. Abre el navegador de tu celular (Safari o Chrome) e ingresa a:
   ```
   http://<TU_IP_LOCAL>:8080
   ```
   *(Ejemplo: `http://192.168.1.15:8080`)*
4. En el celular, el marco de simulador se oculta automáticamente y la app ocupa el **100% de la pantalla táctil** en modo nativo con soporte gestual.

#### Opción B: Modo Desarrollo con Expo Go
1. Instala la app **Expo Go** en tu celular desde App Store (iOS) o Google Play Store (Android).
2. En tu computadora, ejecuta:
   ```bash
   npm start
   ```
3. Escanea el código QR que aparecerá en la terminal con la cámara de tu celular (iOS) o desde la app Expo Go (Android).

---

## 🐳 Despliegue con Docker

El proyecto incluye un `Dockerfile` multi-etapa optimizado que genera la versión estática web de producción y la sirve mediante un contenedor de **Nginx Alpine** de alto rendimiento.

### 1. Despliegue Rápido con Docker Compose
```bash
docker compose up --build -d
```

Una vez levantado, la aplicación estará disponible en:
- **Computador local:** `http://localhost:8080`
- **Celulares en la red local:** `http://<TU_IP_LOCAL>:8080`

Para ver los logs del contenedor:
```bash
docker compose logs -f
```

Para detener el servicio:
```bash
docker compose down
```

### 2. Despliegue Manual con Docker CLI
```bash
# 1. Construir la imagen
docker build -t geopicto-presentacion .

# 2. Ejecutar el contenedor mapeando el puerto 8080
docker run -d --name geopicto-app -p 8080:80 geopicto-presentacion
```

---

## 🛠️ Comandos de Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo Expo
npm start

# Verificar tipado estricto con TypeScript
npx tsc --noEmit

# Compilar exportación web de producción
npm run build
```
