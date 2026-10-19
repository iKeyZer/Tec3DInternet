# Red ITSPe 3D

Plano 3D interactivo con la propuesta de red Wi-Fi y videovigilancia del Instituto Tecnológico Superior de Perote
(19.54616° N, 97.26972° O). Cada access point, cámara y gabinete de red tiene su justificación: al hacer clic,
la vista vuela hasta el punto y un panel explica por qué va ahí, qué cubre, el modelo sugerido y a qué switch se conecta.

**Ver en línea:** https://red-itspe-3d.vercel.app

## Qué incluye

- 40 access points, 24 cámaras y 8 nodos de red (site principal, gabinetes y enlace inalámbrico a invernaderos).
- Mapa de calor de la señal Wi-Fi, por AP o de todo el campus, y porcentaje del campus con señal de −67 dBm o mejor.
- Sector de visión de cada cámara, con las distancias de detección, observación, reconocimiento e identificación
  (criterio DORI) y la opción **Ver lo que ve la cámara**.
- Red troncal de fibra con anillos de respaldo y modo **Rayos X** para ver la distribución interior de los edificios.
- Sección **Investigación y equipos**: buenas prácticas de redes en campus, arquitectura, lista de equipos, VLAN,
  criterios para cámaras, calculadoras de Internet y de almacenamiento, y fuentes.

## Cómo abrirlo

Abre `index.html` en el navegador con doble clic. No necesita servidor, pero sí Internet para cargar Three.js y las tipografías.

También funciona con cualquier servidor estático, por ejemplo:

```bash
python -m http.server 8765
```

## Cómo modificarlo

Casi todo se cambia en [`js/datos.js`](js/datos.js), sin tocar el código 3D:

| Sección | Qué contiene |
| --- | --- |
| `edificios` | Nombre, uso, posición, tamaño, pisos, techo y distribución interior de cada edificio |
| `aps` | Access points: ubicación, modelo, montaje, usuarios previstos, switch y justificación |
| `camaras` | Cámaras: ubicación, hacia dónde apuntan, ángulo, alcance, modelo y justificación |
| `nodos` | Site principal (MDF), gabinetes (IDF) y radios del enlace punto a punto |
| `enlaces` | Fibras, cables y enlaces inalámbricos entre nodos |
| `modelos` | Catálogo de equipos usado en las fichas y en la lista de materiales |

Las posiciones están en píxeles de la imagen satelital (`assets/satelite-campus.webp`, 936 × 675 px, 1 px ≈ 0.45 m).
Los ángulos se miden sobre la imagen: 0° es el este y 90° es el sur. Un edificio con `confirmado: true` tiene su uso
confirmado en sitio; en los demás el uso es un supuesto de diseño.

## Archivos

| Archivo | Contenido |
| --- | --- |
| `index.html` | Estructura de la página y memoria técnica |
| `css/estilos.css` | Estilos con tema claro y oscuro |
| `js/datos.js` | Datos del campus y de la red |
| `js/app.js` | Escena 3D, mapa de cobertura, interacción y paneles |
| `js/satelite.js` | Imagen satelital incrustada, para que funcione sin servidor |
| `assets/satelite-campus.webp` | Imagen satelital original |

Si cambias la imagen de `assets/`, vuelve a generar `js/satelite.js` con su contenido en base64.

## Publicación

El sitio está publicado en https://red-itspe-3d.vercel.app (proyecto `red-itspe-3d` en Vercel).
Es estático: Vercel lo publica tal cual desde este repositorio, sin paso de compilación,
y cada `git push` a `main` actualiza el sitio.

## Supuestos

- El mapa de calor usa un modelo de propagación simplificado (log-distancia en 5 GHz y pérdida por muros).
  Sirve para comparar ubicaciones; la cobertura real se valida con un site survey en sitio.
- Los modelos de equipo son de referencia (ecosistema UniFi de Ubiquiti). Confirma disponibilidad y ficha técnica antes de comprar.
- Los ángulos de visión de las cámaras son de diseño; confirma el lente de cada modelo.

## Créditos

Imagen satelital tomada de Google Maps: © Airbus, CNES / Airbus, Maxar Technologies. Datos del mapa © Google, INEGI.
Visualización 3D con [Three.js](https://threejs.org/).
