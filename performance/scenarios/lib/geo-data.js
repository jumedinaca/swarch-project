/**
 * GeoPicto — Modelo geográfico compartido (Persona 7)
 *
 * Lo usan tanto el seeder (Node, seed-data.mjs) como los escenarios de k6, para
 * que las consultas de carga caigan sobre las mismas zonas que se poblaron.
 *
 * Bogotá se modela como un conjunto de "hotspots" (zonas con mucha actividad,
 * distribución normal de radio sigmaM) más un fondo uniforme de baja densidad.
 * El peso (weight) es la fracción aproximada de mensajes de cada zona.
 *
 * Solo datos, sin dependencias: debe funcionar en Node y en el runtime de k6.
 */

export const HOTSPOTS = [
  // Centro usado por profiles/common.js (Persona 8): debe ser la zona más densa
  { id: 'unal', name: 'Ciudad Universitaria UNAL', lat: 4.6371, lng: -74.0834, sigmaM: 350, weight: 0.3 },
  { id: 'chapinero', name: 'Chapinero / Zona G', lat: 4.6486, lng: -74.0628, sigmaM: 500, weight: 0.12 },
  { id: 'centro', name: 'Centro / La Candelaria', lat: 4.5981, lng: -74.076, sigmaM: 450, weight: 0.12 },
  { id: 'andes', name: 'Universidad de los Andes', lat: 4.6015, lng: -74.0661, sigmaM: 300, weight: 0.06 },
  { id: 'parque93', name: 'Parque 93', lat: 4.6767, lng: -74.0483, sigmaM: 400, weight: 0.08 },
  { id: 'usaquen', name: 'Usaquén', lat: 4.695, lng: -74.031, sigmaM: 500, weight: 0.06 },
  { id: 'salitre', name: 'Salitre / Gran Estación', lat: 4.6476, lng: -74.1018, sigmaM: 600, weight: 0.08 },
  { id: 'suba', name: 'Suba', lat: 4.741, lng: -74.084, sigmaM: 900, weight: 0.06 },
  { id: 'kennedy', name: 'Kennedy', lat: 4.6286, lng: -74.146, sigmaM: 900, weight: 0.06 },
];

// Fondo uniforme (área urbana aproximada de Bogotá)
export const BACKGROUND_BBOX = { minLat: 4.55, maxLat: 4.78, minLng: -74.2, maxLng: -74.02 };

// Zonas sin hotspot (afueras): consultas que devuelven pocos o ningún resultado
export const SPARSE_POINTS = [
  { id: 'bosa', lat: 4.6135, lng: -74.1925 },
  { id: 'usme', lat: 4.5205, lng: -74.1161 },
  { id: 'cerros', lat: 4.6288, lng: -74.0466 },
  { id: 'fontibon-occ', lat: 4.6904, lng: -74.1636 },
];

// Lugares por zona para que el contenido sea verosímil
export const PLACES = {
  unal: ['la Plaza Che', 'el edificio de Ingeniería', 'la Biblioteca Central', 'el Estadio Alfonso López', 'la cafetería de Ciencias', 'el Museo de Arte'],
  chapinero: ['la Zona G', 'el Parque de los Hippies', 'la Séptima', 'la estación de la 57'],
  centro: ['la Plaza de Bolívar', 'el Chorro de Quevedo', 'el Museo del Oro', 'el Parque Santander'],
  andes: ['el bloque ML', 'la plazoleta del Lleras', 'la entrada de la Circunvalar', 'Las Aguas'],
  parque93: ['el Parque 93', 'la calle 93', 'el Parque El Virrey'],
  usaquen: ['el mercado de pulgas', 'la plaza fundacional de Usaquén', 'el parque de Usaquén'],
  salitre: ['el Parque Simón Bolívar', 'la Biblioteca Virgilio Barco', 'Maloka', 'la Gran Estación'],
  suba: ['el centro de Suba', 'el humedal La Conejera', 'el portal de Suba'],
  kennedy: ['el Parque Timiza', 'Corabastos', 'el portal de las Américas'],
  background: ['la ciclovía', 'el paradero del SITP', 'la panadería de la esquina', 'el TransMilenio'],
};

// Plantillas de mensajes (sin correos, teléfonos ni direcciones para no
// disparar las reglas DOXXING de moderation-service)
export const MESSAGE_TEMPLATES = [
  'Hay una feria de emprendimiento en {place}, vale la pena pasar.',
  'Alguien sabe si hoy abren {place}? Está muy solo.',
  'Se recomienda el tinto de {place}, barato y bueno.',
  'Cuidado con los charcos cerca de {place}, se inundó todo con el aguacero.',
  'Estamos armando grupo de estudio en {place}, el que quiera se une.',
  'Encontré unas llaves cerca de {place}, las dejé en portería.',
  'Hoy hay concierto gratis en {place} desde las cinco.',
  'Qué buen atardecer se ve desde {place}.',
  'Mucho trancón por {place}, mejor tomen otra ruta.',
  'Perdí un paraguas negro en {place}, si alguien lo ve me avisa por aquí.',
  'Están regalando plantas en {place}, llegue temprano.',
  'Recomendado el almuerzo ejecutivo cerca de {place}.',
  'Se fue la luz en {place}, alguien sabe qué pasó?',
  'Hay un perrito perdido rondando {place}, parece que tiene collar.',
  'Partido de fútbol en {place} a las cuatro, faltan dos jugadores.',
  'La fila para entrar a {place} está larguísima hoy.',
  'Exposición de fotografía en {place}, entrada libre.',
  'Muy buen ambiente hoy en {place}.',
];
