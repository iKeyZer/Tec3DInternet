/*
 * Red ITSPe 3D — visor del plano de Wi-Fi y videovigilancia.
 * Usa Three.js r147 (variable global THREE) y los datos de js/datos.js.
 */
(function () {
  'use strict';

  const D = window.DATOS_CAMPUS;
  const $ = (sel) => document.querySelector(sel);
  const cargando = $('#cargando');
  const cargandoTexto = $('#cargando-texto');

  function mostrarError(msg) {
    cargando.classList.add('es-error');
    cargandoTexto.textContent = msg;
    cargando.hidden = false;
  }
  if (!window.THREE || !THREE.OrbitControls) {
    mostrarError('No se pudo cargar Three.js. Revisa tu conexión a Internet y recarga la página.');
    return;
  }
  try {
    const prueba = document.createElement('canvas');
    if (!(prueba.getContext('webgl2') || prueba.getContext('webgl'))) throw new Error('sin webgl');
  } catch (e) {
    mostrarError('Tu navegador no tiene WebGL activo, que es necesario para ver el plano 3D.');
    return;
  }

  const T = THREE;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;

  // ------------------------------------------------------------------ utilidades
  const IW = D.imagen.ancho, IH = D.imagen.alto, S = D.imagen.escala;
  const GR = Math.PI / 180;
  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mundo = (px, py, y = 0) => new T.Vector3((px - IW / 2) * S, y, (py - IH / 2) * S);
  const M_LAT = 110600, M_LON = 111320 * Math.cos(D.geo.lat * GR);
  const geo = (px, py) => ({
    lat: D.geo.lat - (py - D.geo.refPx[1]) * S / M_LAT,
    lon: D.geo.lon + (px - D.geo.refPx[0]) * S / M_LON,
  });
  const fmtGeo = (g) => `${g.lat.toFixed(5)}° N · ${Math.abs(g.lon).toFixed(5)}° O`;
  const metros = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * S;
  const fmtNum = (n, d = 0) => n.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function aleatorio(semilla) {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dentroPoligono(x, y, pol) {
    let dentro = false;
    for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
      const [xi, yi] = pol[i], [xj, yj] = pol[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  function dentroEdificio(e, x, y) {
    const a = e.ang * GR, dx = x - e.c[0], dy = y - e.c[1];
    const u = dx * Math.cos(a) + dy * Math.sin(a);
    const w = -dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(u) <= e.l / 2 && Math.abs(w) <= e.a / 2;
  }
  const RUMBOS = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  const rumbo = (yaw) => RUMBOS[Math.round((((yaw + 90) % 360) + 360) % 360 / 45) % 8];
  function token(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || '#888888';
  }

  // ------------------------------------------------------------------ catálogo de puntos
  const edificios = D.edificios;
  const edPorId = {};
  edificios.forEach((e, i) => { edPorId[e.id] = e; e._indice = i + 1; });

  const puntos = [];
  D.aps.forEach((p) => puntos.push(Object.assign(p, { tipo: 'ap' })));
  D.camaras.forEach((p) => puntos.push(Object.assign(p, { tipo: 'cam' })));
  D.nodos.forEach((p) => puntos.push(Object.assign(p, { tipo: 'infra' })));
  const porId = {};
  puntos.forEach((p) => { porId[p.id] = p; });
  puntos.forEach((p) => {
    p.interior = p.tipo === 'ap' ? !p.exterior && !!p.edificio : p.tipo === 'cam' ? !!p.interior : p.clase !== 'ptp';
    p._abierto = !!(p.edificio && edPorId[p.edificio].abierto);
    p._pos3 = mundo(p.pos[0], p.pos[1], p.h);
    const extra = p.tipo === 'infra' && p.clase !== 'ptp' ? 1.3 : 0.5;
    p._ancla = mundo(p.pos[0], p.pos[1], p.h + extra);
  });

  const TIPOS = {
    ap: { titulo: 'Access points', corto: 'Wi-Fi' },
    cam: { titulo: 'Cámaras', corto: 'Cámaras' },
    infra: { titulo: 'Nodos de red', corto: 'Red' },
  };
  const CLASE_CAM = { lpr: 'Cámara lectora de placas', bala: 'Cámara tipo bala', domo: 'Cámara domo', ptz: 'Cámara PTZ', '360': 'Cámara panorámica 360°' };
  const CLASE_INFRA = { mdf: 'Site principal', idf: 'Gabinete de distribución', ptp: 'Enlace punto a punto' };
  const ICONOS = {
    ap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 9.2a14 14 0 0 1 19 0"/><path d="M6 12.8a9 9 0 0 1 12 0"/><path d="M9.4 16.3a4.3 4.3 0 0 1 5.2 0"/><circle cx="12" cy="19.6" r="1.4" fill="currentColor" stroke="none"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="M15.5 10.6l6-3.3v9.4l-6-3.3z"/></svg>',
    infra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h7"/></svg>',
    ptp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M12 21V12"/><path d="M8.4 8.2a5 5 0 0 1 7.2 0"/><path d="M5.4 5.2a9.2 9.2 0 0 1 13.2 0"/><circle cx="12" cy="11.2" r="1.7" fill="currentColor" stroke="none"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  const icono = (p) => `<span class="icono icono--${p.tipo}">${p.clase === 'ptp' ? ICONOS.ptp : ICONOS[p.tipo]}</span>`;
  function tipoTexto(p) {
    if (p.tipo === 'ap') return p.exterior ? 'Access point exterior' : p._abierto ? 'Access point bajo techo' : 'Access point interior';
    if (p.tipo === 'cam') return CLASE_CAM[p.clase];
    return CLASE_INFRA[p.clase];
  }

  // ------------------------------------------------------------------ escena
  const visor = $('#visor');
  const app = $('#app');
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  visor.appendChild(renderer.domElement);
  const anisotropia = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const escena = new T.Scene();
  const camara = new T.PerspectiveCamera(40, 1, 0.5, 5000);
  const controles = new T.OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.screenSpacePanning = false;
  controles.maxPolarAngle = 84 * GR;
  controles.minDistance = 6;
  controles.maxDistance = 950;
  controles.rotateSpeed = 0.6;
  controles.zoomSpeed = 0.9;

  const hemi = new T.HemisphereLight(0xe4eef2, 0x6d604c, 0.85);
  const sol = new T.DirectionalLight(0xfff1dc, 1.05);
  sol.position.set(-140, 280, 190);
  sol.target.position.set(40, 0, 0);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  Object.assign(sol.shadow.camera, { left: -250, right: 250, top: 210, bottom: -210, near: 20, far: 800 });
  sol.shadow.bias = -0.0005;
  sol.shadow.normalBias = 0.5;
  escena.add(hemi, sol, sol.target);

  // ------------------------------------------------------------------ terreno
  const ANCHO = IW * S, ALTO = IH * S;
  const sueloLejano = new T.Mesh(new T.PlaneGeometry(5000, 5000), new T.MeshLambertMaterial({ color: D.imagen.colorBorde }));
  sueloLejano.rotation.x = -Math.PI / 2;
  sueloLejano.position.y = -0.08;
  sueloLejano.receiveShadow = true;
  const sueloMat = new T.MeshLambertMaterial({ color: 0xffffff });
  const suelo = new T.Mesh(new T.PlaneGeometry(ANCHO, ALTO), sueloMat);
  suelo.rotation.x = -Math.PI / 2;
  suelo.receiveShadow = true;
  escena.add(sueloLejano, suelo);

  function texturaDeCanvas(canvas) {
    const t = new T.CanvasTexture(canvas);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisotropia;
    return t;
  }

  function texturaSatelite(img) {
    const c = document.createElement('canvas');
    c.width = IW; c.height = IH;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, IW, IH);
    // Desvanece los bordes hacia el color del terreno para que no se note el recorte.
    const borde = D.imagen.colorBorde, f = 46;
    const rgba = (a) => {
      const n = parseInt(borde.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    [[0, 0, f, 0, 0, 0, f, IH], [IW, 0, IW - f, 0, IW - f, 0, f, IH], [0, 0, 0, f, 0, 0, IW, f], [0, IH, 0, IH - f, 0, IH - f, IW, f]].forEach(([x0, y0, x1, y1, rx, ry, rw, rh]) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, rgba(1));
      gr.addColorStop(1, rgba(0));
      g.fillStyle = gr;
      g.fillRect(rx, ry, rw, rh);
    });
    return texturaDeCanvas(c);
  }

  function texturaMaqueta() {
    const k = 2, c = document.createElement('canvas');
    c.width = IW * k; c.height = IH * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    const rnd = aleatorio(11);
    g.fillStyle = '#cbbf9f';
    g.fillRect(0, 0, IW, IH);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(120,110,80,0.10)' : 'rgba(255,255,240,0.10)';
      g.beginPath();
      g.arc(rnd() * IW, rnd() * IH, 1 + rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const poli = (pts, color) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = color;
      g.fill();
    };
    const linea = (pts, color, ancho, guion) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = color;
      g.lineWidth = ancho;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.setLineDash(guion || []);
      g.stroke();
      g.setLineDash([]);
    };
    const rect = (r, color, cb) => {
      g.save();
      g.translate(r.c[0], r.c[1]);
      g.rotate(r.ang * GR);
      g.fillStyle = color;
      g.fillRect(-r.l / 2, -r.a / 2, r.l, r.a);
      if (cb) cb(r);
      g.restore();
    };
    poli(D.perimetro, '#d8cfb8');
    linea(D.canal, '#7f9a63', 22);
    linea(D.canal, '#6d8d99', 3);
    D.caminos.forEach((cm) => {
      const color = { carretera: '#5c6166', asfalto: '#8f9498', andador: '#c3c1b9', tierra: '#b9a37e' }[cm.tipo];
      linea(cm.pts, color, cm.ancho);
      if (cm.tipo === 'carretera') linea(cm.pts, '#f1f1f1', 0.8, [6, 6]);
    });
    poli(D.plaza, '#cdcdc6');
    poli(D.patio, '#d3ccbc');
    D.estacionamientos.forEach((r) => rect(r, '#a1a5a8', (q) => {
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 0.6;
      for (let x = -q.l / 2 + 3; x < q.l / 2; x += 6) {
        g.beginPath(); g.moveTo(x, -q.a / 2); g.lineTo(x, -q.a / 2 + q.a * 0.42); g.stroke();
        g.beginPath(); g.moveTo(x, q.a / 2); g.lineTo(x, q.a / 2 - q.a * 0.42); g.stroke();
      }
    }));
    rect(D.cancha, '#b5654a', (q) => {
      g.strokeStyle = '#f4efe6';
      g.lineWidth = 0.7;
      g.strokeRect(-q.l / 2 + 2, -q.a / 2 + 2, q.l - 4, q.a - 4);
      g.beginPath(); g.moveTo(0, -q.a / 2 + 2); g.lineTo(0, q.a / 2 - 2); g.stroke();
      g.beginPath(); g.arc(0, 0, 3.5, 0, Math.PI * 2); g.stroke();
    });
    // Huella de los edificios para que se lean bien desde arriba.
    edificios.forEach((e) => rect(e, 'rgba(60,55,45,0.18)'));
    return texturaDeCanvas(c);
  }

  const texMaqueta = texturaMaqueta();
  let texSatelite = null;
  sueloMat.map = texMaqueta;

  // ------------------------------------------------------------------ edificios
  function texturaVentanas(luz) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = luz ? '#000000' : '#ffffff';
    g.fillRect(0, 0, 128, 128);
    if (!luz) {
      g.fillStyle = '#e6e2da';
      g.fillRect(0, 0, 128, 10);
      g.fillStyle = '#d9d4ca';
      g.fillRect(0, 118, 128, 10);
    }
    g.fillStyle = luz ? '#ffd79a' : '#5b7280';
    g.fillRect(16, 36, 96, 52);
    if (!luz) {
      g.fillStyle = '#dfe6ea';
      g.fillRect(62, 36, 4, 52);
      g.fillRect(16, 58, 96, 3);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(18, 38, 42, 18);
      g.fillStyle = '#c9c3b8';
      g.fillRect(12, 88, 104, 5);
    } else {
      g.fillStyle = '#000000';
      g.fillRect(62, 36, 4, 52);
    }
    const t = texturaDeCanvas(c);
    if (luz) t.encoding = T.LinearEncoding;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }
  const texVentana = texturaVentanas(false);
  const texVentanaLuz = texturaVentanas(true);
  const matsVentanas = [];

  function matMuro(e, ancho) {
    const color = new T.Color(e.muro || '#ece7dd');
    if (e.translucido) {
      return new T.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.35, side: T.DoubleSide, depthWrite: false });
    }
    if (e.ventanas === false) return new T.MeshStandardMaterial({ color, roughness: 0.9 });
    const map = texVentana.clone();
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, Math.round(ancho / 3.6)), e.pisos || 1);
    const em = texVentanaLuz.clone();
    em.needsUpdate = true;
    em.repeat.copy(map.repeat);
    const m = new T.MeshStandardMaterial({ color, map, emissive: 0xffcf8a, emissiveMap: em, emissiveIntensity: 0, roughness: 0.88 });
    matsVentanas.push(m);
    return m;
  }

  function geomDosAguas(L, A, r, v) {
    const l = L / 2 + v, a = A / 2 + v;
    const P = { a: [-l, 0, -a], b: [l, 0, -a], c: [l, r, 0], d: [-l, r, 0], e: [-l, 0, a], f: [l, 0, a] };
    const tris = [['a', 'c', 'b'], ['a', 'd', 'c'], ['e', 'f', 'c'], ['e', 'c', 'd'], ['a', 'e', 'd'], ['b', 'c', 'f']];
    const pos = [];
    tris.forEach((t) => t.forEach((k) => pos.push(...P[k])));
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geom.addGroup(0, 6, 0);
    geom.addGroup(6, 6, 1);
    geom.addGroup(12, 6, 2);
    geom.computeVertexNormals();
    return geom;
  }

  function geomArco(L, A, r, n = 24) {
    const l = L / 2 + 0.3, pos = [];
    const pt = (i) => { const t = (Math.PI * i) / n; return [-(A / 2 + 0.3) * Math.cos(t), r * Math.sin(t)]; };
    for (let i = 0; i < n; i++) {
      const [z0, y0] = pt(i), [z1, y1] = pt(i + 1);
      const p1 = [-l, y0, z0], p2 = [l, y0, z0], p3 = [l, y1, z1], p4 = [-l, y1, z1];
      pos.push(...p1, ...p3, ...p2, ...p1, ...p4, ...p3);
    }
    const cuerpo = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [z0, y0] = pt(i), [z1, y1] = pt(i + 1);
      pos.push(-l, 0, 0, -l, y1, z1, -l, y0, z0);
      pos.push(l, 0, 0, l, y0, z0, l, y1, z1);
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geom.addGroup(0, cuerpo, 0);
    geom.addGroup(cuerpo, n * 6, 1);
    geom.computeVertexNormals();
    return geom;
  }

  function texturaCancha(L, A) {
    const k = 24; // píxeles por metro
    const c = document.createElement('canvas');
    c.width = Math.round(L * k);
    c.height = Math.round(A * k);
    const g = c.getContext('2d');
    g.fillStyle = '#9b9f9b';
    g.fillRect(0, 0, c.width, c.height);
    const cl = Math.min(28, L - 2), ca = Math.min(15, A - 1.4);
    const x0 = ((L - cl) / 2) * k, y0 = ((A - ca) / 2) * k, cx = c.width / 2, cy = c.height / 2;
    g.fillStyle = '#2f6e64';
    g.fillRect(x0, y0, cl * k, ca * k);
    g.lineWidth = 0.08 * k;
    // Fútbol rápido (amarillo): áreas de 6 m.
    g.strokeStyle = '#f2c94c';
    [-1, 1].forEach((lado) => {
      const fondo = cx + lado * (cl / 2) * k;
      g.beginPath();
      g.arc(fondo, cy, 6 * k, lado < 0 ? -Math.PI / 2 : Math.PI / 2, lado < 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
      g.stroke();
    });
    // Básquetbol (blanco).
    g.strokeStyle = '#ffffff';
    g.strokeRect(x0, y0, cl * k, ca * k);
    g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y0 + ca * k); g.stroke();
    g.beginPath(); g.arc(cx, cy, 1.8 * k, 0, Math.PI * 2); g.stroke();
    [-1, 1].forEach((lado) => {
      const fondo = cx + lado * (cl / 2) * k;
      g.strokeRect(lado < 0 ? fondo : fondo - 5.8 * k, cy - 2.45 * k, 5.8 * k, 4.9 * k);
      g.beginPath();
      g.arc(fondo - lado * 5.8 * k, cy, 1.8 * k, lado < 0 ? -Math.PI / 2 : Math.PI / 2, lado < 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
      g.stroke();
      g.beginPath();
      g.arc(fondo - lado * 1.575 * k, cy, 6.75 * k, lado < 0 ? -1.35 : Math.PI - 1.35, lado < 0 ? 1.35 : Math.PI + 1.35);
      g.stroke();
    });
    return texturaDeCanvas(c);
  }

  function crearCancha(L, A) {
    const g = new T.Group();
    const piso = new T.Mesh(new T.PlaneGeometry(L - 0.5, A - 0.5), new T.MeshStandardMaterial({ map: texturaCancha(L - 0.5, A - 0.5), roughness: 0.85 }));
    piso.rotation.x = -Math.PI / 2;
    piso.position.y = 0.1;
    piso.receiveShadow = true;
    g.add(piso);
    const cl = Math.min(28, L - 2.5);
    const blanco = new T.MeshStandardMaterial({ color: 0xf4f6f6, roughness: 0.4 });
    const metal = new T.MeshStandardMaterial({ color: 0x55606a, roughness: 0.5, metalness: 0.6 });
    const naranja = new T.MeshStandardMaterial({ color: 0xe0662b, roughness: 0.5 });
    [-1, 1].forEach((lado) => {
      const fondo = (lado * cl) / 2;
      // Tablero de básquetbol: poste detrás de la línea de fondo, tablero a 1.2 m y aro a 1.575 m.
      const poste = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 3.4, 10), metal);
      poste.position.set(fondo + lado * 1.0, 1.7, 0);
      const brazo = new T.Mesh(new T.BoxGeometry(2.2, 0.12, 0.12), metal);
      brazo.position.set(fondo - lado * 0.1, 3.3, 0);
      const tablero = new T.Mesh(new T.BoxGeometry(0.06, 1.05, 1.8), blanco);
      tablero.position.set(fondo - lado * 1.2, 3.45, 0);
      const aro = new T.Mesh(new T.TorusGeometry(0.23, 0.02, 8, 24), naranja);
      aro.rotation.x = Math.PI / 2;
      aro.position.set(fondo - lado * 1.575, 3.05, 0);
      // Portería de fútbol rápido de 3 × 2 m sobre la línea de fondo.
      const porteria = new T.Group();
      [-1.5, 1.5].forEach((z) => {
        const palo = new T.Mesh(new T.BoxGeometry(0.08, 2, 0.08), blanco);
        palo.position.set(0, 1, z);
        porteria.add(palo);
      });
      const travesano = new T.Mesh(new T.BoxGeometry(0.08, 0.08, 3.08), blanco);
      travesano.position.y = 2;
      porteria.add(travesano);
      porteria.position.x = fondo;
      g.add(poste, brazo, tablero, aro, porteria);
    });
    g.traverse((o) => { if (o.isMesh && o !== piso) o.castShadow = true; });
    return g;
  }

  const mallasEdificio = [];
  function crearEdificio(e) {
    const L = e.l * S, A = e.a * S, H = e.h;
    const grupo = new T.Group();
    const mats = [];
    const matTecho = (color, opacidad) => {
      const m = new T.MeshStandardMaterial({ color: new T.Color(color), roughness: 0.75, side: T.DoubleSide });
      if (e.translucido) Object.assign(m, { transparent: true, opacity: opacidad || 0.7, depthWrite: false, roughness: 0.3 });
      mats.push(m);
      return m;
    };
    const mLargo = matMuro(e, L), mCorto = matMuro(e, A);
    const tapa = matTecho(e.techo.color);
    mats.push(mLargo, mCorto);
    const piezas = [];
    if (e.abierto) {
      // Techumbre abierta: columnas y vigas a los costados, la cancha debajo.
      const n = Math.max(2, Math.round(L / 6));
      for (let i = 0; i <= n; i++) {
        [-1, 1].forEach((lado) => {
          const col = new T.Mesh(new T.BoxGeometry(0.4, H, 0.4), mCorto);
          col.position.set(-L / 2 + (L * i) / n, H / 2, lado * (A / 2 - 0.2));
          grupo.add(col);
          piezas.push(col);
        });
      }
      [-1, 1].forEach((lado) => {
        const viga = new T.Mesh(new T.BoxGeometry(L, 0.5, 0.3), mCorto);
        viga.position.set(0, H - 0.25, lado * (A / 2 - 0.2));
        grupo.add(viga);
        piezas.push(viga);
      });
      grupo.add(crearCancha(L, A));
    } else {
      const muros = new T.Mesh(new T.BoxGeometry(L, H, A), [mCorto, mCorto, tapa, tapa, mLargo, mLargo]);
      muros.position.y = H / 2;
      grupo.add(muros);
      piezas.push(muros);
    }

    let techo;
    if (e.techo.tipo === 'dos-aguas') {
      const m0 = matTecho(e.techo.color), m1 = e.techo.color2 ? matTecho(e.techo.color2) : m0;
      techo = new T.Mesh(geomDosAguas(L, A, e.techo.alto, 0.45), [m0, m1, mCorto]);
      techo.position.y = H;
    } else if (e.techo.tipo === 'arco') {
      const tapas = e.abierto ? new T.MeshBasicMaterial({ visible: false }) : mCorto;
      techo = new T.Mesh(geomArco(L, A, e.techo.alto), [matTecho(e.techo.color, 0.8), tapas]);
      techo.position.y = H;
    } else {
      techo = new T.Mesh(new T.BoxGeometry(L + 0.4, 0.45, A + 0.4), tapa);
      techo.position.y = H + 0.2;
    }
    grupo.add(techo);
    piezas.push(techo);
    piezas.forEach((m) => {
      m.castShadow = !e.translucido;
      m.receiveShadow = true;
      m.userData.edificio = e;
      mallasEdificio.push(m);
    });
    grupo.position.copy(mundo(e.c[0], e.c[1]));
    grupo.rotation.y = -e.ang * GR;
    e._grupo = grupo;
    e._mats = mats;
    e._alto = H + (e.techo.alto || 0.5);
    mats.forEach((m) => { m.userData.orig = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }; });
    escena.add(grupo);
  }
  edificios.forEach(crearEdificio);

  function texturaEtiqueta(titulo, sub) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(250,252,251,0.92)';
    g.fillRect(8, 8, 496, 240);
    g.strokeStyle = '#1f4f8f';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 240);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Reduce la letra hasta que el texto quepa en la etiqueta.
    const ajustar = (texto, peso, maximo, familia) => {
      let t = maximo;
      do { g.font = `${peso} ${t}px ${familia}`; t -= 4; } while (g.measureText(texto).width > 460 && t > 24);
    };
    g.fillStyle = '#15201e';
    ajustar(titulo, 700, 104, '"Barlow Condensed", "Arial Narrow", sans-serif');
    g.fillText(titulo, 256, sub ? 104 : 128);
    if (sub) {
      g.fillStyle = '#4c5b58';
      ajustar(sub, 600, 46, 'Barlow, "Segoe UI", sans-serif');
      g.fillText(sub, 256, 192);
    }
    return texturaDeCanvas(c);
  }

  // Dibuja losas, muros interiores, escalera y etiquetas de los cuartos.
  // distribucion: { escalera?: px, niveles: [{ nombre, cuartos: ['Aula 1', { t: 'Enfermería', w: 1 }, ...] }] }
  // Los cuartos van de izquierda (-x) a derecha (+x); con escalera se reparten mitad y mitad.
  function crearInterior(e) {
    const dist = e.distribucion;
    const L = e.l * S, A = e.a * S, hPiso = e.h / e.pisos;
    const s = dist.escalera ? (dist.escalera * S) / 2 : 0;
    const tramos = s ? [[-L / 2, -s], [s, L / 2]] : [[-L / 2, L / 2]];
    const g = new T.Group();
    const matMuroInt = new T.MeshStandardMaterial({ color: 0xf1ede5, transparent: true, opacity: 0.6, roughness: 0.9 });
    const matLosa = new T.MeshStandardMaterial({ color: 0xcfc8bb, transparent: true, opacity: 0.4, depthWrite: false });
    const matEscalon = new T.MeshStandardMaterial({ color: 0xa79f92, roughness: 0.9 });
    dist.niveles.forEach((nivel, k) => {
      const y0 = k * hPiso;
      if (k > 0) {
        const losa = new T.Mesh(new T.BoxGeometry(L - 0.3, 0.2, A - 0.3), matLosa);
        losa.position.y = y0;
        g.add(losa);
      }
      const cuartos = nivel.cuartos.map((c) => (typeof c === 'string' ? { t: c, w: 1 } : c));
      const mitad = Math.ceil(cuartos.length / 2);
      const grupos = s ? [cuartos.slice(0, mitad), cuartos.slice(mitad)] : [cuartos];
      const muros = s ? [-s, s] : [];
      grupos.forEach((lista, j) => {
        const [x0, x1] = tramos[j];
        const total = lista.reduce((suma, c) => suma + c.w, 0);
        let x = x0;
        lista.forEach((c, i) => {
          const ancho = ((x1 - x0) * c.w) / total;
          if (i > 0) muros.push(x);
          const altoEt = Math.min(A * 0.55, ancho * 0.42), anchoEt = altoEt * 2;
          const etiqueta = new T.Mesh(new T.PlaneGeometry(anchoEt, altoEt), new T.MeshBasicMaterial({ map: texturaEtiqueta(c.t, nivel.nombre), transparent: true, toneMapped: false }));
          etiqueta.rotation.x = -Math.PI / 2;
          etiqueta.position.set(x + ancho / 2, y0 + (k === 0 ? 0.65 : 0.25), 0);
          etiqueta.renderOrder = 4;
          g.add(etiqueta);
          x += ancho;
        });
      });
      muros.forEach((x) => {
        const m = new T.Mesh(new T.BoxGeometry(0.18, hPiso - 0.3, A - 0.3), matMuroInt);
        m.position.set(x, y0 + hPiso / 2, 0);
        g.add(m);
      });
    });
    if (s && e.pisos > 1) {
      // Escalera de un tramo en el cubo central.
      const escalones = 12, prof = (A * 0.7) / escalones;
      for (let j = 0; j < escalones; j++) {
        const alto = (hPiso / escalones) * (j + 1);
        const esc = new T.Mesh(new T.BoxGeometry(s * 2 * 0.75, alto, prof), matEscalon);
        esc.position.set(0, alto / 2, A * 0.35 - prof * (j + 0.5));
        g.add(esc);
      }
    }
    g.visible = false;
    e._grupo.add(g);
    e._interior = g;
  }

  function rayosX(e, activo) {
    if (!e || e._rayos === activo) return;
    e._rayos = activo;
    if (activo && e.distribucion && !e._interior) crearInterior(e);
    if (e._interior) e._interior.visible = activo;
    e._mats.forEach((m) => {
      const o = m.userData.orig;
      m.transparent = activo ? true : o.transparent;
      m.opacity = activo ? 0.14 : o.opacity;
      m.depthWrite = activo ? false : o.depthWrite;
      m.needsUpdate = true;
    });
  }

  // Contorno para resaltar un edificio.
  const contorno = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
  contorno.visible = false;
  escena.add(contorno);
  function resaltarEdificio(e) {
    if (!e) { contorno.visible = false; return; }
    contorno.visible = true;
    contorno.position.copy(mundo(e.c[0], e.c[1], e._alto / 2));
    contorno.rotation.y = -e.ang * GR;
    contorno.scale.set(e.l * S + 0.6, e._alto + 0.3, e.a * S + 0.6);
  }

  // ------------------------------------------------------------------ vegetación y autos
  (function crearArboles() {
    const rnd = aleatorio(29);
    const lista = D.arboles.map(([x, y]) => [x, y, 1]);
    for (let i = 0; i < D.canal.length - 1; i++) {
      const [x0, y0] = D.canal[i], [x1, y1] = D.canal[i + 1];
      const largo = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / largo, ny = (x1 - x0) / largo;
      for (let k = 0; k < largo / 9; k++) {
        if (rnd() < 0.3) continue;
        const t = rnd(), off = (rnd() - 0.5) * 26;
        const x = x0 + (x1 - x0) * t + nx * off, y = y0 + (y1 - y0) * t + ny * off;
        if (x > 0 && x < IW && y > 0 && y < IH) lista.push([x, y, 0.75 + rnd() * 0.3]);
      }
    }
    const n = lista.length;
    const troncos = new T.InstancedMesh(new T.CylinderGeometry(0.16, 0.26, 1, 6), new T.MeshStandardMaterial({ color: 0x5d4a38, roughness: 1 }), n);
    const copas = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({ roughness: 1, flatShading: true }), n);
    const verdes = ['#4d6b3a', '#5b7a41', '#3f5f37', '#6b8549', '#556f3c'].map((h) => new T.Color(h));
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), eY = new T.Vector3(0, 1, 0);
    lista.forEach(([x, y, k], i) => {
      const r = (2 + rnd() * 1.8) * k, alto = 1.6 + r * 0.7;
      const w = mundo(x, y);
      m.compose(p.set(w.x, alto / 2, w.z), q.identity(), s.set(1, alto, 1));
      troncos.setMatrixAt(i, m);
      q.setFromAxisAngle(eY, rnd() * Math.PI);
      m.compose(p.set(w.x, alto + r * 0.75, w.z), q, s.set(r, r * 0.92, r));
      copas.setMatrixAt(i, m);
      copas.setColorAt(i, verdes[i % verdes.length].clone().lerp(verdes[(i * 7) % verdes.length], rnd()));
    });
    [troncos, copas].forEach((im) => { im.castShadow = true; im.receiveShadow = true; escena.add(im); });
  })();

  (function crearAutos() {
    const rnd = aleatorio(5);
    const lugares = [];
    D.estacionamientos.forEach((r, j) => {
      const a = r.ang * GR, ux = Math.cos(a), uy = Math.sin(a), vx = -Math.sin(a), vy = Math.cos(a);
      for (let t = -r.l / 2 + 4; t < r.l / 2 - 3; t += 6) {
        [-1, 1].forEach((lado) => {
          if (rnd() < (j === 0 ? 0.42 : 0.7)) return;
          const off = lado * r.a * 0.27;
          lugares.push([r.c[0] + ux * t + vx * off, r.c[1] + uy * t + vy * off, r.ang]);
        });
      }
    });
    const n = lugares.length;
    const cuerpos = new T.InstancedMesh(new T.BoxGeometry(1.8, 0.85, 4.3), new T.MeshStandardMaterial({ roughness: 0.45, metalness: 0.25 }), n);
    const cabinas = new T.InstancedMesh(new T.BoxGeometry(1.6, 0.6, 2.3), new T.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.25, metalness: 0.4 }), n);
    const colores = ['#f2f2f0', '#b9bec2', '#7c8287', '#2a2d31', '#9b2d2a', '#2f4f7a', '#e9e6dc'].map((h) => new T.Color(h));
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), eY = new T.Vector3(0, 1, 0);
    lugares.forEach(([x, y, ang], i) => {
      const w = mundo(x, y);
      q.setFromAxisAngle(eY, -ang * GR + (rnd() - 0.5) * 0.12);
      m.compose(new T.Vector3(w.x, 0.62, w.z), q, s);
      cuerpos.setMatrixAt(i, m);
      cuerpos.setColorAt(i, colores[Math.floor(rnd() * colores.length)]);
      m.compose(new T.Vector3(w.x, 1.3, w.z), q, s);
      cabinas.setMatrixAt(i, m);
    });
    [cuerpos, cabinas].forEach((im) => { im.castShadow = true; escena.add(im); });
  })();

  // Barda perimetral translúcida.
  (function crearPerimetro() {
    const pts = D.perimetro.concat([D.perimetro[0]]).map(([x, y]) => mundo(x, y));
    const pos = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      pos.push(a.x, 0, a.z, b.x, 0, b.z, b.x, 2.2, b.z, a.x, 0, a.z, b.x, 2.2, b.z, a.x, 2.2, a.z);
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    const barda = new T.Mesh(geom, new T.MeshBasicMaterial({ color: 0x33413e, transparent: true, opacity: 0.16, side: T.DoubleSide, depthWrite: false }));
    const remate = new T.Line(new T.BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(2.2))), new T.LineBasicMaterial({ color: 0x33413e, transparent: true, opacity: 0.55 }));
    escena.add(barda, remate);
  })();

  // ------------------------------------------------------------------ colores por tipo
  const colores = { ap: new T.Color(), cam: new T.Color(), infra: new T.Color() };
  const matsTipo = { ap: [], cam: [], infra: [] };
  function matTipo(tipo, opciones, Clase = T.MeshBasicMaterial) {
    const m = new Clase(Object.assign({ color: colores[tipo].clone() }, opciones));
    matsTipo[tipo].push(m);
    return m;
  }
  colores.ap.set(token('--ap'));
  colores.cam.set(token('--cam'));
  colores.infra.set(token('--infra'));

  // ------------------------------------------------------------------ dispositivos 3D
  const matBlanco = new T.MeshStandardMaterial({ color: 0xf3f5f5, roughness: 0.45 });
  const matNegro = new T.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.3, metalness: 0.35 });
  const matPoste = new T.MeshStandardMaterial({ color: 0x8b9297, roughness: 0.55, metalness: 0.55 });
  const ESC = 2.1;

  function crearModelo(p) {
    const g = new T.Group();
    const base = mundo(p.pos[0], p.pos[1]);
    g.position.copy(base);
    const poste = /poste|mástil/i.test(p.montaje || '') || p.clase === 'ptp';
    if (poste) {
      const tubo = new T.Mesh(new T.CylinderGeometry(0.12, 0.16, p.h, 8), matPoste);
      tubo.position.y = p.h / 2;
      tubo.castShadow = true;
      g.add(tubo);
    }
    const disp = new T.Group();
    disp.position.y = p.h;
    disp.scale.setScalar(ESC);
    g.add(disp);
    if (p.tipo === 'ap') {
      if (p.interior && p.modelo !== 'U7 Pro Outdoor') {
        const disco = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.1, 28), matBlanco);
        disco.position.y = -0.06;
        const aro = new T.Mesh(new T.TorusGeometry(0.3, 0.035, 8, 32), matTipo('ap'));
        aro.rotation.x = Math.PI / 2;
        aro.position.y = -0.12;
        disp.add(disco, aro);
      } else {
        const caja = new T.Mesh(new T.BoxGeometry(0.3, 0.7, 0.16), matBlanco);
        caja.position.y = -0.35;
        const led = new T.Mesh(new T.BoxGeometry(0.1, 0.03, 0.17), matTipo('ap'));
        led.position.y = -0.14;
        disp.add(caja, led);
      }
    } else if (p.tipo === 'cam') {
      const orient = new T.Group();
      orient.rotation.y = -p.yaw * GR;
      const cabeceo = new T.Group();
      cabeceo.rotation.z = (p.pitch || 0) * GR;
      orient.add(cabeceo);
      disp.add(orient);
      if (p.clase === 'bala' || p.clase === 'lpr') {
        const cuerpo = new T.Mesh(new T.BoxGeometry(0.75, 0.24, 0.24), p.clase === 'lpr' ? matNegro : matBlanco);
        cuerpo.position.x = 0.2;
        const visera = new T.Mesh(new T.BoxGeometry(0.85, 0.04, 0.32), matBlanco);
        visera.position.set(0.25, 0.15, 0);
        const lente = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.04, 16), matTipo('cam'));
        lente.rotation.z = Math.PI / 2;
        lente.position.x = 0.59;
        const brazo = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.3, 8), matBlanco);
        brazo.position.set(-0.1, 0.12, 0);
        cabeceo.add(cuerpo, visera, lente, brazo);
      } else if (p.clase === 'domo' || p.clase === '360') {
        const basee = new T.Mesh(new T.CylinderGeometry(p.clase === '360' ? 0.42 : 0.3, 0.32, 0.08, 24), matBlanco);
        const domo = new T.Mesh(new T.SphereGeometry(p.clase === '360' ? 0.24 : 0.22, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), matNegro);
        basee.position.y = -0.04;
        domo.position.y = -0.08;
        const marca = new T.Mesh(new T.TorusGeometry(0.26, 0.025, 6, 24), matTipo('cam'));
        marca.rotation.x = Math.PI / 2;
        marca.position.y = -0.09;
        disp.add(basee, domo, marca);
      } else if (p.clase === 'ptz') {
        const soporte = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.3, 16), matBlanco);
        soporte.position.y = -0.15;
        const cuerpo = new T.Mesh(new T.SphereGeometry(0.3, 20, 14), matBlanco);
        cuerpo.position.y = -0.45;
        const lente = new T.Mesh(new T.SphereGeometry(0.2, 16, 10), matNegro);
        lente.position.set(0.16, -0.5, 0);
        const marca = new T.Mesh(new T.TorusGeometry(0.3, 0.025, 6, 24), matTipo('cam'));
        marca.rotation.x = Math.PI / 2;
        marca.position.y = -0.33;
        orient.add(soporte, cuerpo, lente, marca);
      }
    } else {
      if (p.clase === 'ptp') {
        const par = porId[p.pareja];
        const ang = Math.atan2(par.pos[1] - p.pos[1], par.pos[0] - p.pos[0]);
        const panel = new T.Mesh(new T.BoxGeometry(0.16, 0.5, 0.5), matBlanco);
        panel.rotation.y = -ang;
        const led = new T.Mesh(new T.BoxGeometry(0.17, 0.06, 0.2), matTipo('infra'));
        led.rotation.y = -ang;
        led.position.y = -0.18;
        disp.add(panel, led);
      } else {
        const rack = new T.Mesh(new T.BoxGeometry(0.45, 1.0, 0.5), matNegro);
        const luces = new T.Mesh(new T.BoxGeometry(0.46, 0.5, 0.05), matTipo('infra'));
        luces.position.set(0, 0.05, 0.24);
        disp.position.y = ESC * 0.95 * 0.5;
        disp.scale.setScalar(ESC * 0.95);
        disp.add(rack, luces);
      }
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    escena.add(g);
    p._modelo = g;
  }
  puntos.forEach(crearModelo);

  // ------------------------------------------------------------------ campos de visión
  const DORI = [
    { nivel: 'Identificación', ppm: 250 },
    { nivel: 'Reconocimiento', ppm: 125 },
    { nivel: 'Observación', ppm: 62 },
    { nivel: 'Detección', ppm: 25 },
  ];
  const distanciaDori = (c, ppm) => (D.modelos[c.modelo].resH || 2688) / (2 * ppm * Math.tan((c.hfov / 2) * GR));

  function sector(o, a0, a1, r0, r1, y, n = 36) {
    const pos = [];
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const p = (t, r) => [o.x + Math.cos(t) * r, y, o.z + Math.sin(t) * r];
      pos.push(...p(t0, r0), ...p(t1, r1), ...p(t0, r1), ...p(t0, r0), ...p(t1, r0), ...p(t1, r1));
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    return geom;
  }

  const grupoVision = new T.Group();
  escena.add(grupoVision);
  function crearVision(c) {
    const g = new T.Group();
    const o = c._pos3;
    const suelo0 = new T.Vector3(o.x, 0, o.z);
    const R = c.alcance;
    const mSector = matTipo('cam', { transparent: true, opacity: 0.13, depthWrite: false, side: T.DoubleSide });
    const mFuerte = matTipo('cam', { transparent: true, opacity: 0.24, depthWrite: false, side: T.DoubleSide });
    const mCono = matTipo('cam', { transparent: true, opacity: 0.05, depthWrite: false, side: T.DoubleSide });
    const mLinea = matTipo('cam', { transparent: true, opacity: 0.6 }, T.LineBasicMaterial);
    const cono = new T.Group();
    if (c.clase === '360') {
      g.add(new T.Mesh(sector(suelo0, 0, Math.PI * 2, 0.5, R, 0.32, 64), mSector));
      g.add(new T.Mesh(sector(suelo0, 0, Math.PI * 2, 0.5, R * 0.45, 0.34, 64), mFuerte));
      const aro = [];
      for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2; aro.push(new T.Vector3(o.x + Math.cos(t) * R, 0.36, o.z + Math.sin(t) * R)); }
      g.add(new T.Line(new T.BufferGeometry().setFromPoints(aro), mLinea));
      const lineas = [];
      for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; lineas.push(o, new T.Vector3(o.x + Math.cos(t) * R, 0.36, o.z + Math.sin(t) * R)); }
      cono.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(lineas), mLinea));
    } else {
      const a0 = (c.yaw - c.hfov / 2) * GR, a1 = (c.yaw + c.hfov / 2) * GR;
      const vfov = 2 * Math.atan(Math.tan((c.hfov / 2) * GR) * 0.5625);
      const inclinacion = Math.abs(c.pitch || 0) * GR + vfov / 2;
      const r0 = Math.min(R * 0.6, Math.max(0.8, c.h / Math.tan(Math.min(inclinacion, 1.4))));
      const rId = Math.min(R, Math.max(r0 + 0.5, distanciaDori(c, 125)));
      g.add(new T.Mesh(sector(suelo0, a0, a1, r0, R, 0.32), mSector));
      g.add(new T.Mesh(sector(suelo0, a0, a1, r0, rId, 0.34), mFuerte));
      const arco = [];
      for (let i = 0; i <= 36; i++) { const t = a0 + ((a1 - a0) * i) / 36; arco.push(new T.Vector3(o.x + Math.cos(t) * R, 0.36, o.z + Math.sin(t) * R)); }
      g.add(new T.Line(new T.BufferGeometry().setFromPoints(arco), mLinea));
      const cerca = (t) => new T.Vector3(o.x + Math.cos(t) * r0, 0.36, o.z + Math.sin(t) * r0);
      cono.add(new T.LineSegments(new T.BufferGeometry().setFromPoints([o, arco[0], o, arco[36], o, cerca(a0), o, cerca(a1)]), mLinea));
      const abanico = [];
      for (let i = 0; i < 36; i++) abanico.push(o.x, o.y, o.z, arco[i].x, arco[i].y, arco[i].z, arco[i + 1].x, arco[i + 1].y, arco[i + 1].z);
      const ga = new T.BufferGeometry();
      ga.setAttribute('position', new T.Float32BufferAttribute(abanico, 3));
      cono.add(new T.Mesh(ga, mCono));
      if (c.clase === 'ptz') {
        const giro = [];
        for (let i = 0; i <= 96; i++) { const t = (i / 96) * Math.PI * 2; giro.push(new T.Vector3(o.x + Math.cos(t) * R, 0.36, o.z + Math.sin(t) * R)); }
        const punteada = new T.Line(new T.BufferGeometry().setFromPoints(giro), matTipo('cam', { transparent: true, opacity: 0.7, dashSize: 3, gapSize: 2.5 }, T.LineDashedMaterial));
        punteada.computeLineDistances();
        g.add(punteada);
      }
    }
    g.add(cono);
    g.userData = { mats: [mSector, mFuerte, mCono, mLinea], base: [0.13, 0.24, 0.05, 0.6], cono };
    c._vision = g;
    grupoVision.add(g);
  }
  puntos.filter((p) => p.tipo === 'cam').forEach(crearVision);

  // ------------------------------------------------------------------ red troncal
  const grupoRed = new T.Group();
  escena.add(grupoRed);
  const paquetes = [];
  const lineasDash = [];
  function curvaEntre(a, b) {
    const pa = a.clase === 'ptp' || a.tipo !== 'infra' ? a._pos3.clone() : a._pos3.clone().setY(a.h + 1.2);
    const pb = b.clase === 'ptp' || b.tipo !== 'infra' ? b._pos3.clone() : b._pos3.clone().setY(b.h + 1.2);
    const medio = pa.clone().lerp(pb, 0.5);
    const d = pa.distanceTo(pb);
    medio.y = Math.max(pa.y, pb.y) + 5 + d * 0.16;
    return new T.QuadraticBezierCurve3(pa, medio, pb);
  }
  const ESTILO_ENLACE = {
    fibra: { radio: 0.38, opacidad: 0.95 },
    respaldo: { radio: 0.26, opacidad: 0.45 },
    cobre: { radio: 0.24, opacidad: 0.8 },
  };
  D.enlaces.forEach((en) => {
    const a = porId[en.de], b = porId[en.a];
    const curva = curvaEntre(a, b);
    en._curva = curva;
    en._largo = metros(a.pos, b.pos);
    if (en.tipo === 'inalambrico') {
      const linea = new T.Line(new T.BufferGeometry().setFromPoints(curva.getPoints(60)), matTipo('infra', { dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.95 }, T.LineDashedMaterial));
      linea.computeLineDistances();
      lineasDash.push(linea.material);
      grupoRed.add(linea);
    } else {
      const est = ESTILO_ENLACE[en.tipo];
      const tubo = new T.Mesh(new T.TubeGeometry(curva, 64, est.radio, 6), matTipo('infra', { transparent: true, opacity: est.opacidad }));
      grupoRed.add(tubo);
    }
    for (let k = 0; k < (en.tipo === 'fibra' ? 3 : 2); k++) {
      const bola = new T.Mesh(new T.SphereGeometry(en.tipo === 'fibra' ? 0.85 : 0.6, 12, 8), new T.MeshBasicMaterial({ color: 0xffffff }));
      grupoRed.add(bola);
      paquetes.push({ bola, curva, fase: k / 3, vel: 0.12 + (en.tipo === 'fibra' ? 0.06 : 0) });
    }
  });

  // Enlace de acceso del punto seleccionado (cable hacia su switch).
  let enlaceAcceso = null;
  function mostrarEnlaceAcceso(p) {
    if (enlaceAcceso) {
      escena.remove(enlaceAcceso);
      enlaceAcceso.geometry.dispose();
      enlaceAcceso = null;
    }
    if (!p || !p.uplink) return;
    const nodo = porId[p.uplink];
    const curva = curvaEntre(p, nodo);
    const mat = new T.LineDashedMaterial({ color: colores[p.tipo], dashSize: 1.4, gapSize: 1, transparent: true, opacity: 1 });
    enlaceAcceso = new T.Line(new T.BufferGeometry().setFromPoints(curva.getPoints(50)), mat);
    enlaceAcceso.computeLineDistances();
    escena.add(enlaceAcceso);
  }

  // ------------------------------------------------------------------ cobertura Wi-Fi
  const CEL = 3, GW = Math.ceil(IW / CEL), GH = Math.ceil(IH / CEL);
  const mascara = new Uint8Array(GW * GH);
  const perdidaMuro = [0], perdidaInterior = [0];
  edificios.forEach((e) => {
    perdidaMuro[e._indice] = e.abierto ? 0 : e.translucido ? 3 : 10;
    perdidaInterior[e._indice] = e.abierto ? 0 : 0.35; // dB por metro de tabiques interiores
  });
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CEL, y = (gy + 0.5) * CEL;
      for (const e of edificios) {
        if (dentroEdificio(e, x, y)) { mascara[gy * GW + gx] = e._indice; break; }
      }
    }
  }
  const dentroCampus = new Uint8Array(GW * GH);
  let celdasCampus = 0;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      if (dentroPoligono((gx + 0.5) * CEL, (gy + 0.5) * CEL, D.perimetro)) { dentroCampus[gy * GW + gx] = 1; celdasCampus++; }
    }
  }
  const PL1 = 47.3, N_EXP = 2.7;
  const radioUtil = (eirp) => Math.pow(10, (eirp - PL1 + 67) / (10 * N_EXP));

  function calcularSenal(aps) {
    const mejor = new Float32Array(GW * GH).fill(-200);
    aps.forEach((ap) => {
      const eirp = D.modelos[ap.modelo].eirp;
      const [ax, ay] = ap.pos;
      const gx0 = Math.floor(ax / CEL), gy0 = Math.floor(ay / CEL);
      const bAp = ap.exterior ? 0 : mascara[gy0 * GW + gx0];
      const radioPx = ap.interior && !ap._abierto ? 150 : 330;
      const rc = Math.ceil(radioPx / CEL);
      for (let gy = Math.max(0, gy0 - rc); gy <= Math.min(GH - 1, gy0 + rc); gy++) {
        for (let gx = Math.max(0, gx0 - rc); gx <= Math.min(GW - 1, gx0 + rc); gx++) {
          const cx = (gx + 0.5) * CEL, cy = (gy + 0.5) * CEL;
          const dx = cx - ax, dy = cy - ay;
          const dPx = Math.hypot(dx, dy);
          if (dPx > radioPx) continue;
          const pasos = Math.max(1, Math.ceil(dPx / 4.5));
          let previo = bAp, perdida = 0, interior = 0;
          for (let s = 1; s <= pasos; s++) {
            const t = s / pasos;
            const b = mascara[Math.floor((ay + dy * t) / CEL) * GW + Math.floor((ax + dx * t) / CEL)] || 0;
            if (b !== previo) {
              if (previo) perdida += perdidaMuro[previo];
              if (b) perdida += perdidaMuro[b];
              previo = b;
            }
            if (b) interior += (dPx / pasos) * S * perdidaInterior[b];
          }
          const d = Math.max(1, dPx * S);
          const rssi = eirp - (PL1 + 10 * N_EXP * Math.log10(d)) - perdida - interior;
          const i = gy * GW + gx;
          if (rssi > mejor[i]) mejor[i] = rssi;
        }
      }
    });
    return mejor;
  }

  const RAMPA = [
    [-78, [255, 146, 43, 0]],
    [-75, [255, 146, 43, 0.38]],
    [-70, [252, 196, 25, 0.48]],
    [-64, [148, 216, 45, 0.55]],
    [-55, [18, 184, 134, 0.6]],
    [-42, [12, 150, 136, 0.68]],
  ];
  function colorRssi(v) {
    if (v <= RAMPA[0][0]) return null;
    for (let i = 1; i < RAMPA.length; i++) {
      if (v <= RAMPA[i][0]) {
        const [v0, c0] = RAMPA[i - 1], [v1, c1] = RAMPA[i];
        const t = (v - v0) / (v1 - v0);
        return c0.map((x, k) => x + (c1[k] - x) * t);
      }
    }
    return RAMPA[RAMPA.length - 1][1];
  }
  function canvasSenal(mejor) {
    const c = document.createElement('canvas');
    c.width = GW; c.height = GH;
    const g = c.getContext('2d');
    const img = g.createImageData(GW, GH);
    for (let i = 0; i < mejor.length; i++) {
      const col = colorRssi(mejor[i]);
      if (!col) continue;
      img.data[i * 4] = col[0];
      img.data[i * 4 + 1] = col[1];
      img.data[i * 4 + 2] = col[2];
      img.data[i * 4 + 3] = Math.round(col[3] * 255);
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  const matCobertura = new T.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  const planoCobertura = new T.Mesh(new T.PlaneGeometry(GW * CEL * S, GH * CEL * S), matCobertura);
  planoCobertura.rotation.x = -Math.PI / 2;
  planoCobertura.position.set(((GW * CEL) / 2 - IW / 2) * S, 0.45, ((GH * CEL) / 2 - IH / 2) * S);
  planoCobertura.visible = false;
  planoCobertura.renderOrder = 2;
  escena.add(planoCobertura);
  let texCoberturaGlobal = null, texCoberturaAp = null;
  const listaAps = puntos.filter((p) => p.tipo === 'ap');

  function calcularCoberturaGlobal() {
    const mejor = calcularSenal(listaAps);
    let buenas = 0;
    for (let i = 0; i < mejor.length; i++) if (dentroCampus[i] && mejor[i] >= -67) buenas++;
    texCoberturaGlobal = texturaDeCanvas(canvasSenal(mejor));
    const pct = (100 * buenas) / celdasCampus;
    $('#n-cob').textContent = `${fmtNum(pct)} %`;
    actualizarCobertura();
  }

  // ------------------------------------------------------------------ marcadores HTML
  const capaMarcadores = $('#marcadores');
  const tooltip = $('#tooltip');
  puntos.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pin pin--${p.tipo}`;
    b.dataset.id = p.id;
    b.setAttribute('aria-label', `${p.id}: ${p.nombre}`);
    b.innerHTML = `<span class="pin__cuerpo"><span class="pin__chapa">${icono(p)}<span class="pin__id">${p.id}</span></span><span class="pin__tallo"></span><span class="pin__punto"></span></span>`;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); detenerRecorrido(); seleccionar(p); });
    b.addEventListener('pointerenter', () => mostrarTooltip(`<b>${esc(p.id)} · ${esc(tipoTexto(p))}</b>${esc(p.nombre)}`, p._pantalla));
    b.addEventListener('pointerleave', ocultarTooltip);
    capaMarcadores.appendChild(b);
    p._pin = b;
    p._pantalla = { x: -999, y: -999 };
  });

  function mostrarTooltip(html, punto) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const w = visor.clientWidth;
    const x = Math.min(w - 270, Math.max(8, punto.x + 14));
    tooltip.style.transform = `translate(${x}px, ${Math.max(8, punto.y - 64)}px)`;
  }
  function ocultarTooltip() { tooltip.hidden = true; }

  const proy = new T.Vector3();
  function actualizarPines() {
    const w = visor.clientWidth, h = visor.clientHeight;
    for (const p of puntos) {
      const el = p._pin;
      if (el.hidden) continue;
      proy.copy(p._ancla).project(camara);
      if (proy.z > 1 || Math.abs(proy.x) > 1.15 || Math.abs(proy.y) > 1.15) {
        el.style.transform = 'translate(-9999px,-9999px)';
        continue;
      }
      const x = (proy.x * 0.5 + 0.5) * w, y = (-proy.y * 0.5 + 0.5) * h;
      p._pantalla.x = x;
      p._pantalla.y = y;
      const dist = p._ancla.distanceTo(camara.position);
      const lejos = dist > 235 && p !== estado.seleccion;
      if (lejos !== p._lejos) { el.classList.toggle('pin--lejos', lejos); p._lejos = lejos; }
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      el.style.zIndex = p === estado.seleccion ? 5000 : String(4000 - Math.round(dist));
    }
  }

  // ------------------------------------------------------------------ estado y capas
  const estado = {
    seleccion: null,
    edificioSel: null,
    filtro: 'todos',
    busqueda: '',
    capas: { satelite: true, cobertura: false, vision: true, red: true, etiquetas: true, rayosx: false },
    anim: null,
    vistaCamara: null,
    recorrido: null,
    desfase: { x: 0, y: 0 },
  };

  function aplicarCapas() {
    const c = estado.capas;
    if (texSatelite) {
      sueloMat.map = c.satelite ? texSatelite : texMaqueta;
      sueloMat.needsUpdate = true;
      aplicarTema();
    }
    grupoRed.visible = c.red;
    capaMarcadores.classList.toggle('sin-etiquetas', !c.etiquetas);
    edificios.forEach((e) => rayosX(e, c.rayosx || e === edificioDeSeleccion()));
    actualizarVision();
    actualizarCobertura();
    document.querySelectorAll('.capa').forEach((b) => b.setAttribute('aria-pressed', String(!!c[b.dataset.capa])));
  }

  function edificioDeSeleccion() {
    const p = estado.seleccion;
    if (p && p.interior && p.edificio) return edPorId[p.edificio];
    return estado.edificioSel && estado.edificioSel._rayosSel ? estado.edificioSel : null;
  }

  function visiblePorFiltro(p) {
    if (estado.filtro !== 'todos' && p.tipo !== estado.filtro) return false;
    const q = estado.busqueda;
    if (!q) return true;
    const ed = p.edificio ? edPorId[p.edificio].nombre : '';
    return `${p.id} ${p.nombre} ${p.modelo || ''} ${ed} ${tipoTexto(p)}`.toLowerCase().includes(q);
  }

  function actualizarVision() {
    const sel = estado.seleccion;
    puntos.forEach((p) => {
      if (p.tipo !== 'cam') return;
      const g = p._vision;
      const esSel = sel === p;
      g.visible = estado.vistaCamara !== p && (esSel || (estado.capas.vision && visiblePorFiltro(p)));
      const factor = sel && !esSel ? 0.4 : esSel ? 1.9 : 1;
      g.userData.mats.forEach((m, i) => { m.opacity = Math.min(0.95, g.userData.base[i] * factor); });
    });
  }

  function actualizarCobertura() {
    const sel = estado.seleccion;
    const leyenda = $('#leyenda-cobertura');
    const titulo = $('#leyenda-cobertura-titulo');
    if (sel && sel.tipo === 'ap') {
      if (texCoberturaAp) texCoberturaAp.dispose();
      texCoberturaAp = texturaDeCanvas(canvasSenal(calcularSenal([sel])));
      matCobertura.map = texCoberturaAp;
      matCobertura.needsUpdate = true;
      planoCobertura.visible = true;
      titulo.textContent = `Señal estimada de ${sel.id} en 5 GHz`;
      leyenda.hidden = false;
      return;
    }
    if (estado.capas.cobertura && texCoberturaGlobal) {
      matCobertura.map = texCoberturaGlobal;
      matCobertura.needsUpdate = true;
      planoCobertura.visible = true;
      titulo.textContent = 'Señal estimada en 5 GHz · mejor AP en cada punto';
      leyenda.hidden = false;
    } else {
      planoCobertura.visible = false;
      leyenda.hidden = true;
    }
  }

  document.querySelectorAll('.capa').forEach((b) => {
    b.addEventListener('click', () => {
      estado.capas[b.dataset.capa] = !estado.capas[b.dataset.capa];
      aplicarCapas();
    });
  });

  // ------------------------------------------------------------------ tema claro / oscuro
  function aplicarTema() {
    const cielo = new T.Color(token('--cielo'));
    const oscuro = cielo.getHSL({}).l < 0.25;
    escena.background = cielo;
    escena.fog = new T.Fog(cielo, 520, 1700);
    colores.ap.set(token('--ap'));
    colores.cam.set(token('--cam'));
    colores.infra.set(token('--infra'));
    Object.keys(matsTipo).forEach((k) => matsTipo[k].forEach((m) => m.color.copy(colores[k])));
    contorno.material.color.set(token('--acento'));
    hemi.intensity = oscuro ? 0.42 : 0.85;
    hemi.color.set(oscuro ? 0x8fa6c4 : 0xe4eef2);
    sol.intensity = oscuro ? 0.5 : 1.05;
    sol.color.set(oscuro ? 0xc9d6ff : 0xfff1dc);
    const tinte = oscuro ? 0.62 : 1;
    sueloMat.color.setScalar(tinte);
    sueloLejano.material.color.set(estado.capas.satelite ? D.imagen.colorBorde : '#cbbf9f').multiplyScalar(tinte);
    matsVentanas.forEach((m) => { m.emissiveIntensity = oscuro ? 0.75 : 0; });
    if (enlaceAcceso && estado.seleccion) enlaceAcceso.material.color.copy(colores[estado.seleccion.tipo]);
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema);
  new MutationObserver(aplicarTema).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ------------------------------------------------------------------ cámara: vistas y vuelos
  const OBJ_CAMPUS = mundo(548, 318, 0);
  const SO = new T.Vector3(-0.643, 0, 0.766); // suroeste: perpendicular al eje del campus
  const SE = new T.Vector3(0.788, 0, 0.616); // sureste: a lo largo del eje del campus
  const vertical = () => camara.aspect < 0.8;
  // En pantallas verticales el campus se ve a lo largo de su eje para que quepa.
  function vistaIsometrica() {
    if (vertical()) return { pos: OBJ_CAMPUS.clone().addScaledVector(SE, 240).setY(340), obj: OBJ_CAMPUS.clone().addScaledVector(SE, -30) };
    return { pos: OBJ_CAMPUS.clone().addScaledVector(SO, 245).setY(285), obj: OBJ_CAMPUS.clone() };
  }
  function vistaAerea() {
    if (vertical()) return { pos: OBJ_CAMPUS.clone().addScaledVector(SE, 2).setY(640), obj: OBJ_CAMPUS.clone() };
    return { pos: OBJ_CAMPUS.clone().addScaledVector(SO, 2).setY(500), obj: OBJ_CAMPUS.clone() };
  }

  function volar(pos, obj, opciones = {}) {
    const dur = reducirMovimiento ? 0 : opciones.dur || 1500;
    estado.anim = {
      p0: camara.position.clone(), o0: controles.target.clone(),
      p1: pos.clone(), o1: obj.clone(),
      f0: camara.fov, f1: opciones.fov || 40,
      t0: performance.now(), dur,
      arco: Math.min(70, camara.position.distanceTo(pos) * 0.22),
      alTerminar: opciones.alTerminar,
    };
    controles.enabled = false;
  }

  function pasoAnimacion(ahora) {
    const a = estado.anim;
    if (!a) return;
    const t = a.dur ? Math.min(1, (ahora - a.t0) / a.dur) : 1;
    const k = suave(t);
    camara.position.lerpVectors(a.p0, a.p1, k);
    camara.position.y += Math.sin(Math.PI * k) * a.arco;
    controles.target.lerpVectors(a.o0, a.o1, k);
    camara.fov = a.f0 + (a.f1 - a.f0) * k;
    camara.updateProjectionMatrix();
    camara.lookAt(controles.target);
    if (t >= 1) {
      estado.anim = null;
      controles.enabled = !estado.vistaCamara;
      if (a.alTerminar) a.alTerminar();
    }
  }

  // Busca, empezando por el ángulo actual, un azimut desde el que ningún otro edificio tape el objetivo.
  function azimutLibre(obj, dist, polar, azInicial, propio) {
    escena.updateMatrixWorld();
    const rayo = new T.Raycaster();
    rayo.far = dist;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const az = azInicial + (k * Math.PI) / 4;
      rayo.set(obj, new T.Vector3(Math.sin(az) * Math.sin(polar), Math.cos(polar), Math.cos(az) * Math.sin(polar)));
      const tapa = rayo.intersectObjects(mallasEdificio, false).some((h) => h.object.userData.edificio !== propio);
      if (!tapa) return az;
    }
    return azInicial;
  }

  function encuadre(p) {
    if (p.tipo === 'cam' && p.clase !== '360' && !p.interior) {
      const dir = new T.Vector3(Math.cos(p.yaw * GR), 0, Math.sin(p.yaw * GR));
      const base = p._pos3.clone().setY(0);
      const f = vertical() ? 1.5 : 1;
      const obj = base.clone().addScaledVector(dir, p.alcance * 0.42);
      const pos = base.clone().addScaledVector(dir, -(p.alcance * 0.6 + 28) * f).setY((p.alcance * 0.7 + 32) * f);
      pos.addScaledVector(new T.Vector3(-dir.z, 0, dir.x), p.alcance * 0.25);
      return { pos, obj };
    }
    const obj = p._pos3.clone();
    if (!p.interior) obj.y = Math.min(obj.y, 2);
    const off = camara.position.clone().sub(controles.target);
    let az = Math.atan2(off.x, off.z);
    if (off.lengthSq() < 1) az = Math.atan2(SO.x, SO.z);
    const dist = (p.tipo === 'ap' ? (p.interior ? 75 : 130) : p.tipo === 'cam' ? 60 : p.clase === 'ptp' ? 90 : 65) * (vertical() ? 1.5 : 1);
    // Desde más arriba en interiores, para que los edificios vecinos no tapen la vista.
    const polar = (p.interior ? 38 : p.tipo === 'ap' ? 48 : 52) * GR;
    az = azimutLibre(obj, dist, polar, az, p.edificio ? edPorId[p.edificio] : null);
    const pos = obj.clone().add(new T.Vector3(Math.sin(az) * Math.sin(polar) * dist, Math.cos(polar) * dist, Math.cos(az) * Math.sin(polar) * dist));
    return { pos, obj };
  }

  $('#v-iso').addEventListener('click', () => { detenerRecorrido(); salirVistaCamara(true); const v = vistaIsometrica(); volar(v.pos, v.obj); });
  $('#v-aerea').addEventListener('click', () => { detenerRecorrido(); salirVistaCamara(true); const v = vistaAerea(); volar(v.pos, v.obj); });

  // ------------------------------------------------------------------ vista desde una cámara
  const vistaCam = $('#vista-camara');
  let relojCam = null;
  function verDesdeCamara(c) {
    detenerRecorrido();
    const dir = new T.Vector3(Math.cos(c.yaw * GR) * Math.cos(c.pitch * GR), Math.sin(c.pitch * GR), Math.sin(c.yaw * GR) * Math.cos(c.pitch * GR));
    const pos = c._pos3.clone().addScaledVector(dir, 0.9);
    const obj = c._pos3.clone().addScaledVector(dir, 30);
    const vfov = (2 * Math.atan(Math.tan((c.hfov / 2) * GR) * 0.5625)) / GR;
    estado.vistaCamara = c;
    actualizarVision();
    ocultarTooltip();
    volar(pos, obj, {
      fov: vfov,
      dur: 1700,
      alTerminar: () => {
        app.classList.add('en-camara');
        vistaCam.hidden = false;
        $('#vc-id').textContent = `${c.id} · ${c.nombre}`;
        $('#vc-info').textContent = `${c.modelo} · campo horizontal ${c.hfov}° · alcance de diseño ${c.alcance} m`;
        const tic = () => { $('#vc-reloj').textContent = new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' }); };
        tic();
        clearInterval(relojCam);
        relojCam = setInterval(tic, 1000);
        $('#vc-salir').focus();
      },
    });
  }
  function salirVistaCamara(sinVolar) {
    if (!estado.vistaCamara) return;
    const c = estado.vistaCamara;
    estado.vistaCamara = null;
    app.classList.remove('en-camara');
    vistaCam.hidden = true;
    clearInterval(relojCam);
    actualizarVision();
    if (!sinVolar) {
      const v = encuadre(c);
      volar(v.pos, v.obj, { fov: 40 });
    } else {
      camara.fov = 40;
      camara.updateProjectionMatrix();
      controles.enabled = true;
    }
  }
  $('#vc-salir').addEventListener('click', () => salirVistaCamara(false));

  // ------------------------------------------------------------------ anillo de pulso
  const pulso = new T.Mesh(new T.RingGeometry(0.85, 1, 48), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: T.DoubleSide }));
  pulso.rotation.x = -Math.PI / 2;
  pulso.visible = false;
  pulso.renderOrder = 3;
  escena.add(pulso);

  // ------------------------------------------------------------------ selección
  const detalle = $('#detalle');

  function seleccionar(p, opciones = {}) {
    if (estado.vistaCamara) salirVistaCamara(true);
    const previo = estado.seleccion;
    if (previo && previo.interior && previo.edificio) rayosX(edPorId[previo.edificio], estado.capas.rayosx);
    if (estado.edificioSel) {
      estado.edificioSel._rayosSel = false;
      rayosX(estado.edificioSel, estado.capas.rayosx);
      estado.edificioSel = null;
    }
    estado.seleccion = p;
    resaltarEdificio(null);
    puntos.forEach((q) => q._pin.classList.toggle('is-activo', q === p));
    capaMarcadores.classList.toggle('hay-seleccion', !!p);
    document.querySelectorAll('.item').forEach((it) => it.setAttribute('aria-current', String(!!p && it.dataset.id === p.id)));
    if (p && p.interior && p.edificio) rayosX(edPorId[p.edificio], true);
    mostrarEnlaceAcceso(p);
    actualizarVision();
    actualizarCobertura();
    if (!p) {
      detalle.hidden = true;
      pulso.visible = false;
      actualizarHash('');
      return;
    }
    pulso.visible = true;
    pulso.material.color.copy(colores[p.tipo]);
    pulso.position.set(p._pos3.x, 0.6, p._pos3.z);
    renderDetalle(p);
    actualizarHash(p.id);
    if (!opciones.sinVolar) {
      const v = encuadre(p);
      volar(v.pos, v.obj);
    }
    const item = document.querySelector(`.item[data-id="${p.id}"]`);
    if (item) item.scrollIntoView({ block: 'nearest', behavior: reducirMovimiento ? 'auto' : 'smooth' });
  }

  function seleccionarEdificio(e) {
    if (estado.vistaCamara) return;
    seleccionar(null);
    estado.edificioSel = e;
    resaltarEdificio(e);
    renderEdificio(e);
    const obj = mundo(e.c[0], e.c[1], 0);
    const off = camara.position.clone().sub(controles.target);
    const polar = 46 * GR, dist = Math.max(85, e.l * S * 2.6) * (vertical() ? 1.5 : 1);
    const az = azimutLibre(obj.clone().setY(1.5), dist, polar, Math.atan2(off.x, off.z), e);
    volar(obj.clone().add(new T.Vector3(Math.sin(az) * Math.sin(polar) * dist, Math.cos(polar) * dist, Math.cos(az) * Math.sin(polar) * dist)), obj);
  }

  function actualizarHash(id) {
    try { history.replaceState(null, '', id ? `#${id}` : location.pathname + location.search); } catch (e) { /* sin historial */ }
  }

  // ------------------------------------------------------------------ panel de detalle
  function visibles() { return puntos.filter(visiblePorFiltro); }

  function chip(p) {
    return `<button type="button" class="relacionado" data-ir="${p.id}" title="${esc(p.nombre)}">${icono(p)}${p.id}</button>`;
  }

  function filasFicha(p) {
    const filas = [];
    const ed = p.edificio ? edPorId[p.edificio] : null;
    const g = geo(p.pos[0], p.pos[1]);
    if (p.tipo === 'ap') {
      const eirp = D.modelos[p.modelo].eirp;
      filas.push(['Modelo sugerido', p.modelo]);
      filas.push(['Montaje', p.montaje]);
      filas.push(['Altura', `${fmtNum(p.h, 1)} m`]);
      filas.push(['Ubicación', ed ? ed.nombre : 'Exterior']);
      filas.push(['Usuarios previstos', `≈ ${p.usuarios} simultáneos`]);
      filas.push(['Radio a −67 dBm', p.interior && !p._abierto ? '≈ 15–20 m dentro del edificio' : `≈ ${fmtNum(radioUtil(eirp))} m en campo abierto`]);
      filas.push(['Bandas', p.exterior || p._abierto ? '2.4 · 5 · 6 GHz' : '5 · 6 GHz (2.4 GHz en baja potencia)']);
    } else if (p.tipo === 'cam') {
      filas.push(['Modelo sugerido', p.modelo]);
      filas.push(['Montaje', p.montaje]);
      filas.push(['Altura', `${fmtNum(p.h, 1)} m`]);
      filas.push(['Ubicación', ed ? ed.nombre : 'Exterior']);
      if (p.clase === '360') filas.push(['Campo de visión', '360° (ojo de pez)']);
      else {
        filas.push(['Apunta hacia el', `${rumbo(p.yaw)} (${fmtNum(((p.yaw + 90) % 360 + 360) % 360)}°)`]);
        filas.push(['Campo horizontal', `${p.hfov}°${p.clase === 'ptz' ? ' en posición predeterminada' : ''}`]);
      }
      filas.push(['Alcance de diseño', `${p.alcance} m`]);
      filas.push(['Nivel buscado', p.objetivo]);
    } else {
      filas.push(['Ubicación', ed ? ed.nombre : 'Mástil exterior']);
      filas.push(['Equipos', p.equipos.map(esc).join('<br>')]);
    }
    if (p.uplink) {
      const n = porId[p.uplink];
      const m = metros(p.pos, n.pos);
      filas.push(['Conexión', `${n.id} · Cat6A ≈ ${fmtNum(m * 1.25)} m de cable`]);
      filas.push(['Alimentación', p.tipo === 'ap' ? 'PoE+ (802.3at) desde el switch' : 'PoE desde el switch']);
    }
    filas.push(['Coordenadas', `<span class="mono">${fmtGeo(g)}</span>`]);
    return filas;
  }

  function seccionDori(p) {
    if (p.clase === '360') {
      return `<section><h3>Nivel de detalle (DORI)</h3><p class="notas">Con lente ojo de pez la densidad de píxeles cambia en cada punto de la imagen. Se usa para observar el espacio completo; para identificar rostros se complementa con cámaras en los accesos.</p></section>`;
    }
    const maxD = Math.max(...DORI.map((d) => distanciaDori(p, d.ppm)));
    const filas = DORI.map((d) => {
      const dist = distanciaDori(p, d.ppm);
      const objetivo = d.nivel === p.objetivo;
      return `<div class="dori__fila${objetivo ? ' es-objetivo' : ''}"><span>${d.nivel}${objetivo ? ' ◂' : ''}</span><span class="dori__barra"><span style="width:${Math.max(3, (100 * dist) / maxD).toFixed(1)}%"></span></span><span class="dori__valor">${fmtNum(dist, dist < 10 ? 1 : 0)} m</span></div>`;
    }).join('');
    return `<section><h3>Hasta dónde ve cada nivel de detalle</h3><div class="dori">${filas}</div><p class="modelo-desc">Calculado con ${D.modelos[p.modelo].resH} px horizontales y ${p.hfov}° de campo (IEC 62676-4). La franja más intensa del sector en el plano es la zona de reconocimiento.</p></section>`;
  }

  function renderDetalle(p) {
    const lista = visibles();
    const idx = lista.indexOf(p);
    const modelo = p.modelo ? D.modelos[p.modelo] : null;
    const conectados = puntos.filter((q) => q.uplink === p.id);
    const enlaces = D.enlaces.filter((en) => en.de === p.id || en.a === p.id);
    const vecinos = p.edificio ? puntos.filter((q) => q !== p && q.edificio === p.edificio) : [];
    const ficha = filasFicha(p).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    let html = `
      <div class="detalle__cabeza">
        <span class="detalle__tipo">${esc(tipoTexto(p))}</span>
        <span class="detalle__id">${p.id}</span>
        <h2 id="detalle-titulo">${esc(p.nombre)}</h2>
        <button type="button" class="detalle__cerrar" data-accion="cerrar" aria-label="Cerrar detalle">${ICONOS.cerrar}</button>
      </div>
      <div class="detalle__cuerpo">
        <section><h3>Por qué va aquí</h3><p class="porque">${esc(p.porque)}</p></section>`;
    if (p.tipo === 'cam' && !p.interior && p.clase !== '360') {
      html += `<div class="acciones"><button type="button" class="boton boton--primario" data-accion="ver-camara">Ver lo que ve la cámara</button></div>`;
    }
    html += `<section><h3>Qué cubre</h3><ul class="cubre">${p.cubre.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>`;
    if (p.notas) html += `<p class="notas">${esc(p.notas)}</p>`;
    html += `<section><h3>Ficha</h3><dl class="datos">${ficha}</dl>${modelo ? `<p class="modelo-desc">${esc(modelo.desc)}</p>` : ''}</section>`;
    if (p.tipo === 'cam') html += seccionDori(p);
    if (enlaces.length) {
      html += `<section><h3>Enlaces troncales</h3><ul class="cubre">${enlaces.map((en) => {
        const otro = porId[en.de === p.id ? en.a : en.de];
        return `<li>${otro.id} · ${esc(en.etiqueta)} · ≈ ${fmtNum(en._largo)} m en línea recta</li>`;
      }).join('')}</ul></section>`;
    }
    if (conectados.length) html += `<section><h3>Equipos conectados (${conectados.length})</h3><div class="relacionados">${conectados.map(chip).join('')}</div></section>`;
    if (p.uplink) html += `<section><h3>Se conecta a</h3><div class="relacionados">${chip(porId[p.uplink])}</div></section>`;
    if (vecinos.length) html += `<section><h3>En el mismo edificio</h3><div class="relacionados">${vecinos.map(chip).join('')}</div></section>`;
    html += `</div>
      <div class="detalle__pie">
        <button type="button" class="boton" data-accion="anterior" ${idx < 0 ? 'disabled' : ''}>◂ Anterior</button>
        <span class="detalle__pos">${idx >= 0 ? `${idx + 1} de ${lista.length}` : ''}</span>
        <button type="button" class="boton" data-accion="siguiente" ${idx < 0 ? 'disabled' : ''}>Siguiente ▸</button>
      </div>`;
    detalle.className = `detalle detalle--${p.tipo}`;
    detalle.setAttribute('aria-labelledby', 'detalle-titulo');
    detalle.innerHTML = html;
    detalle.hidden = false;
  }

  function renderEdificio(e) {
    const dentro = puntos.filter((q) => q.edificio === e.id);
    const L = e.l * S, A = e.a * S;
    const html = `
      <div class="detalle__cabeza">
        <span class="detalle__tipo">Edificio</span>
        <span class="detalle__id">${e.id.toUpperCase()}</span>
        <h2 id="detalle-titulo">${esc(e.nombre)}</h2>
        <button type="button" class="detalle__cerrar" data-accion="cerrar" aria-label="Cerrar detalle">${ICONOS.cerrar}</button>
      </div>
      <div class="detalle__cuerpo">
        <section><h3>${e.confirmado ? 'Uso' : 'Uso supuesto'}</h3><p class="porque">${esc(e.uso)}</p></section>
        <section><h3>Ficha</h3><dl class="datos">
          <dt>Dimensiones</dt><dd>${fmtNum(L)} × ${fmtNum(A)} m</dd>
          <dt>Superficie</dt><dd>≈ ${fmtNum(L * A * (e.pisos || 1))} m² en ${e.pisos || 1} ${e.pisos > 1 ? 'niveles' : 'nivel'}</dd>
          <dt>Altura</dt><dd>≈ ${fmtNum(e._alto, 1)} m</dd>
          ${e.distribucion && e.distribucion.escalera ? '<dt>Escalera</dt><dd>Al centro, con los cuartos repartidos a cada lado</dd>' : ''}
          ${e.distribucion ? e.distribucion.niveles.map((n, k) => `<dt>${e.pisos > 1 ? (k === 0 ? 'Planta baja' : 'Planta alta') : 'Distribución'}</dt><dd>${n.nombre ? `${esc(n.nombre)}: ` : ''}${n.cuartos.map((c) => esc(typeof c === 'string' ? c : c.t)).join(', ')}</dd>`).join('') : ''}
          <dt>Coordenadas</dt><dd><span class="mono">${fmtGeo(geo(e.c[0], e.c[1]))}</span></dd>
        </dl></section>
        <div class="acciones"><button type="button" class="boton" data-accion="rayos-edificio" aria-pressed="${!!e._rayosSel}">Ver interior con rayos X</button></div>
        <section><h3>${dentro.length ? `Equipos en este edificio (${dentro.length})` : 'Equipos en este edificio'}</h3>${dentro.length ? `<div class="relacionados">${dentro.map(chip).join('')}</div>` : '<p class="notas">No lleva equipos propios; lo cubren los access points y cámaras cercanos.</p>'}</section>
      </div>`;
    detalle.className = 'detalle';
    detalle.setAttribute('aria-labelledby', 'detalle-titulo');
    detalle.innerHTML = html;
    detalle.hidden = false;
  }
  function mover(delta) {
    const lista = visibles();
    if (!lista.length) return;
    const i = lista.indexOf(estado.seleccion);
    const sig = lista[(i + delta + lista.length) % lista.length];
    seleccionar(sig);
  }

  function cerrarDetalle() {
    seleccionar(null);
  }

  detalle.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.ir) { detenerRecorrido(); seleccionar(porId[b.dataset.ir]); return; }
    const acc = b.dataset.accion;
    if (acc === 'cerrar') { detenerRecorrido(); cerrarDetalle(); }
    if (acc === 'anterior') { detenerRecorrido(); mover(-1); }
    if (acc === 'siguiente') { detenerRecorrido(); mover(1); }
    if (acc === 'ver-camara' && estado.seleccion) verDesdeCamara(estado.seleccion);
    if (acc === 'rayos-edificio' && estado.edificioSel) {
      const e = estado.edificioSel;
      e._rayosSel = !e._rayosSel;
      rayosX(e, e._rayosSel || estado.capas.rayosx);
      b.setAttribute('aria-pressed', String(e._rayosSel));
    }
  });

  // ------------------------------------------------------------------ lista lateral
  const listaCuerpo = $('#lista-cuerpo');
  function renderLista() {
    let out = '';
    ['ap', 'cam', 'infra'].forEach((tipo) => {
      const items = puntos.filter((p) => p.tipo === tipo && visiblePorFiltro(p));
      if (!items.length) return;
      out += `<div class="lista__grupo"><span>${TIPOS[tipo].titulo}</span><span>${items.length}</span></div>`;
      out += items.map((p) => `<button type="button" class="item" data-id="${p.id}" style="--c: var(--${tipo})" aria-current="${estado.seleccion === p}">${icono(p)}<span class="item__texto"><span class="item__id">${p.id}</span><span class="item__nombre">${esc(p.nombre)}</span></span></button>`).join('');
    });
    listaCuerpo.innerHTML = out || '<p class="lista__vacia">Ningún punto coincide con la búsqueda.</p>';
    puntos.forEach((p) => { p._pin.hidden = !visiblePorFiltro(p); });
    actualizarVision();
  }
  listaCuerpo.addEventListener('click', (ev) => {
    const it = ev.target.closest('.item');
    if (!it) return;
    detenerRecorrido();
    seleccionar(porId[it.dataset.id]);
    if (window.matchMedia('(max-width: 760px)').matches) alternarLista(false);
  });
  document.querySelectorAll('.filtro').forEach((b) => {
    b.addEventListener('click', () => {
      estado.filtro = b.dataset.filtro;
      document.querySelectorAll('.filtro').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderLista();
    });
  });
  $('#buscar').addEventListener('input', (ev) => {
    estado.busqueda = ev.target.value.trim().toLowerCase();
    renderLista();
  });
  const listaEl = $('#lista');
  const toggleLista = $('#toggle-lista');
  function alternarLista(abrir) {
    const abierta = abrir === undefined ? !listaEl.classList.contains('abierta') : abrir;
    listaEl.classList.toggle('abierta', abierta);
    toggleLista.setAttribute('aria-expanded', String(abierta));
  }
  toggleLista.addEventListener('click', () => alternarLista());

  // ------------------------------------------------------------------ recorrido automático
  const botonRecorrido = $('#v-recorrido');
  function iniciarRecorrido() {
    salirVistaCamara(true);
    estado.recorrido = { timer: null };
    botonRecorrido.setAttribute('aria-pressed', 'true');
    botonRecorrido.textContent = 'Detener recorrido';
    const paso = () => {
      if (!estado.recorrido) return;
      mover(1);
      estado.recorrido.timer = setTimeout(paso, 6500);
    };
    paso();
  }
  function detenerRecorrido() {
    if (!estado.recorrido) return;
    clearTimeout(estado.recorrido.timer);
    estado.recorrido = null;
    botonRecorrido.setAttribute('aria-pressed', 'false');
    botonRecorrido.textContent = 'Recorrido';
  }
  botonRecorrido.addEventListener('click', () => (estado.recorrido ? detenerRecorrido() : iniciarRecorrido()));

  // ------------------------------------------------------------------ puntero sobre el 3D
  const raycaster = new T.Raycaster();
  const ndc = new T.Vector2();
  const planoSuelo = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const golpe = new T.Vector3();
  let inicioPuntero = null, edificioHover = null, punteroPendiente = null;
  const cursorGeo = $('#cursor-geo');

  function rayoDesde(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camara);
  }
  function edificioBajo(ev) {
    rayoDesde(ev);
    const hit = raycaster.intersectObjects(mallasEdificio, false)[0];
    return hit ? hit.object.userData.edificio : null;
  }
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    inicioPuntero = { x: ev.clientX, y: ev.clientY };
    detenerRecorrido();
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!inicioPuntero || estado.vistaCamara) return;
    const movido = Math.hypot(ev.clientX - inicioPuntero.x, ev.clientY - inicioPuntero.y);
    inicioPuntero = null;
    if (movido > 6) return;
    const e = edificioBajo(ev);
    if (e) seleccionarEdificio(e);
    else if (estado.seleccion || estado.edificioSel) cerrarDetalle();
  });
  renderer.domElement.addEventListener('pointermove', (ev) => { punteroPendiente = ev; });
  renderer.domElement.addEventListener('pointerleave', () => {
    punteroPendiente = null;
    edificioHover = null;
    visor.classList.remove('sobre-edificio');
    ocultarTooltip();
    if (!estado.edificioSel) resaltarEdificio(null);
  });
  function procesarPuntero() {
    const ev = punteroPendiente;
    if (!ev || estado.anim || estado.vistaCamara || ev.buttons) return;
    punteroPendiente = null;
    rayoDesde(ev);
    if (raycaster.ray.intersectPlane(planoSuelo, golpe)) {
      cursorGeo.textContent = fmtGeo(geo(golpe.x / S + IW / 2, golpe.z / S + IH / 2));
    }
    const e = edificioBajo(ev);
    if (e !== edificioHover) {
      edificioHover = e;
      visor.classList.toggle('sobre-edificio', !!e);
      if (!estado.edificioSel) resaltarEdificio(e);
    }
    if (e) {
      const r = renderer.domElement.getBoundingClientRect();
      mostrarTooltip(`<b>Edificio · clic para ver detalle</b>${esc(e.nombre)}`, { x: ev.clientX - r.left, y: ev.clientY - r.top + 40 });
    } else if (!tooltip.hidden && !ev.target.closest('.pin')) ocultarTooltip();
  }

  // ------------------------------------------------------------------ teclado
  document.addEventListener('keydown', (ev) => {
    if (dialogo.open) return;
    const enCampo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if (ev.key === 'Escape') {
      detenerRecorrido();
      if (estado.vistaCamara) salirVistaCamara(false);
      else cerrarDetalle();
    }
    if (enCampo) return;
    if (ev.key === 'ArrowRight' && estado.seleccion) { detenerRecorrido(); mover(1); }
    if (ev.key === 'ArrowLeft' && estado.seleccion) { detenerRecorrido(); mover(-1); }
  });

  // ------------------------------------------------------------------ investigación
  const dialogo = $('#investigacion');
  $('#abrir-investigacion').addEventListener('click', () => {
    detenerRecorrido();
    if (dialogo.showModal) dialogo.showModal(); else dialogo.setAttribute('open', '');
  });
  $('#cerrar-investigacion').addEventListener('click', () => (dialogo.close ? dialogo.close() : dialogo.removeAttribute('open')));
  dialogo.addEventListener('click', (ev) => { if (ev.target === dialogo) dialogo.close(); });

  (function tablaMateriales() {
    const filas = [];
    const sumar = (modelo, donde, cant = 1) => {
      let f = filas.find((x) => x.modelo === modelo);
      if (!f) { f = { modelo, cant: 0, donde: [] }; filas.push(f); }
      f.cant += cant;
      if (!f.donde.includes(donde)) f.donde.push(donde);
    };
    puntos.filter((p) => p.tipo !== 'infra').forEach((p) => sumar(p.modelo, p.id));
    let ups = 0;
    D.nodos.forEach((n) => n.equipos.forEach((eq) => {
      const clave = Object.keys(D.modelos).find((m) => eq === m || eq.startsWith(m + ' '));
      if (clave === 'UBB') { if (n.id === 'PTP-A') sumar('UBB', 'Edificio I ↔ invernaderos'); return; }
      if (clave) sumar(clave, n.id);
      if (/^UPS/.test(eq)) ups++;
    }));
    const orden = ['ap', 'cam', 'red'];
    filas.sort((a, b) => orden.indexOf(D.modelos[a.modelo].familia) - orden.indexOf(D.modelos[b.modelo].familia));
    const resumir = (l) => (l.length > 4 ? `${l.slice(0, 3).join(', ')} y ${l.length - 3} más` : l.join(', '));
    const cuerpo = filas.map((f) => `<tr><td>${esc(f.modelo)}</td><td>${esc(D.modelos[f.modelo].desc)}</td><td class="num">${f.modelo === 'UBB' ? '1 kit' : f.cant}</td><td>${esc(resumir(f.donde))}</td></tr>`).join('')
      + `<tr><td>UPS</td><td>Respaldo de energía: en línea de 3 kVA en el MDF y de 1 a 1.5 kVA en cada gabinete.</td><td class="num">${ups}</td><td>MDF y gabinetes</td></tr>`;
    $('#tabla-materiales tbody').innerHTML = cuerpo;
    const nAp = puntos.filter((p) => p.tipo === 'ap').length, nCam = puntos.filter((p) => p.tipo === 'cam').length;
    $('#arq-resumen').textContent = `${nAp} access points Wi-Fi 7 y ${nCam} cámaras IP`;
  })();

  (function calculadoras() {
    const v = (id) => parseFloat($(id).value);
    const out = (id, txt) => { $(id).textContent = txt; };
    const PLANES = [100, 200, 300, 500, 1000, 2000, 5000, 10000];
    function red() {
      const alumnos = v('#c-alumnos'), personal = v('#c-personal'), disp = v('#c-disp'), conc = v('#c-conc'), mbps = v('#c-mbps'), porAp = v('#c-porap');
      out('#o-alumnos', fmtNum(alumnos));
      out('#o-personal', fmtNum(personal));
      out('#o-disp', fmtNum(disp, 1));
      out('#o-conc', `${conc} %`);
      out('#o-mbps', fmtNum(mbps, 2));
      out('#o-porap', porAp);
      const clientes = (alumnos + personal) * disp * (conc / 100);
      const ancho = clientes * mbps;
      const plan = PLANES.find((x) => x >= ancho) || PLANES[PLANES.length - 1];
      out('#r-clientes', fmtNum(clientes));
      out('#r-internet', `${fmtNum(ancho)} Mb/s → ${plan >= 1000 ? `${fmtNum(plan / 1000)} Gb/s` : `${plan} Mb/s`}`);
      out('#r-aps', fmtNum(Math.ceil(clientes / porAp)));
    }
    function nvr() {
      const cams = v('#c-cams'), br = v('#c-bitrate'), dias = v('#c-dias'), mov = v('#c-mov');
      out('#o-cams', cams);
      out('#o-bitrate', fmtNum(br, 1));
      out('#o-dias', dias);
      out('#o-mov', `${mov} %`);
      const tb = (cams * br * 1e6 / 8 * 86400 * dias * (mov / 100)) / 1e12;
      const discos = Math.max(3, Math.ceil(tb / 8) + 1);
      out('#r-tb', `${fmtNum(tb, 1)} TB`);
      out('#r-discos', discos <= 7 ? `${discos} discos` : `${discos} discos (más de 7: usa discos de 16 TB)`);
    }
    $('#calc-red').addEventListener('input', red);
    $('#calc-nvr').addEventListener('input', nvr);
    [$('#calc-red'), $('#calc-nvr')].forEach((f) => f.addEventListener('submit', (ev) => ev.preventDefault()));
    $('#c-cams').value = String(puntos.filter((p) => p.tipo === 'cam').length);
    red();
    nvr();
  })();

  // ------------------------------------------------------------------ cifras del título
  $('#n-ap').textContent = puntos.filter((p) => p.tipo === 'ap').length;
  $('#n-cam').textContent = puntos.filter((p) => p.tipo === 'cam').length;
  $('#n-infra').textContent = puntos.filter((p) => p.tipo === 'infra').length;

  // ------------------------------------------------------------------ brújula y escala
  const brujula = $('#brujula');
  const barraEscala = $('#escala-barra');
  const textoEscala = $('#escala-texto');
  const ejeY = new T.Vector3();
  let ultimaBrujula = null, ultimaEscala = null;
  function actualizarCajetin(h) {
    ejeY.setFromMatrixColumn(camara.matrixWorld, 1);
    if (Math.abs(ejeY.x) + Math.abs(ejeY.z) < 1e-4) ejeY.setFromMatrixColumn(camara.matrixWorld, 2).negate();
    const ang = (-Math.atan2(ejeY.x, -ejeY.z) / GR).toFixed(1);
    if (ang !== ultimaBrujula) { brujula.style.transform = `rotate(${ang}deg)`; ultimaBrujula = ang; }
    const d = camara.position.distanceTo(controles.target);
    const mpp = (2 * d * Math.tan((camara.fov / 2) * GR)) / h;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
    const largo = nice.find((n) => n / mpp >= 64) || 500;
    const px = Math.round(largo / mpp);
    const clave = `${largo}-${px}`;
    if (clave !== ultimaEscala) {
      barraEscala.style.width = `${Math.min(150, px)}px`;
      textoEscala.textContent = `${largo} m`;
      ultimaEscala = clave;
    }
  }

  // ------------------------------------------------------------------ tamaño y encuadre
  function areaLibre() {
    const w = visor.clientWidth, h = visor.clientHeight;
    const movil = window.matchMedia('(max-width: 760px)').matches;
    let izq = 0, der = 0, abajo = 0;
    if (movil) {
      if (!detalle.hidden) abajo = detalle.offsetHeight;
    } else {
      const l = listaEl.getBoundingClientRect();
      if (l.width) izq = l.right;
      if (!detalle.hidden) der = w - detalle.getBoundingClientRect().left;
    }
    if (estado.vistaCamara) { izq = 0; der = 0; abajo = 0; }
    return { x: -(izq - der) / 2, y: abajo / 2 };
  }
  function redimensionar() {
    const w = visor.clientWidth, h = visor.clientHeight;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  window.addEventListener('resize', redimensionar);

  // ------------------------------------------------------------------ bucle
  const reloj = new T.Clock();
  function cuadro(ahora) {
    requestAnimationFrame(cuadro);
    const dt = Math.min(0.05, reloj.getDelta());
    const w = visor.clientWidth, h = visor.clientHeight;
    if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio())) redimensionar();

    const meta = areaLibre();
    const k = reducirMovimiento ? 1 : 1 - Math.pow(0.0015, dt);
    estado.desfase.x += (meta.x - estado.desfase.x) * k;
    estado.desfase.y += (meta.y - estado.desfase.y) * k;
    camara.setViewOffset(w, h, estado.desfase.x, estado.desfase.y, w, h);

    if (estado.anim) pasoAnimacion(ahora);
    else if (!estado.vistaCamara) controles.update();

    const t = ahora / 1000;
    paquetes.forEach((pq) => {
      const u = (pq.fase + t * pq.vel) % 1;
      pq.curva.getPointAt(u, pq.bola.position);
    });
    lineasDash.forEach((m) => { m.dashOffset = -t * 4; });
    if (enlaceAcceso) enlaceAcceso.material.dashOffset = -t * 3;
    if (pulso.visible) {
      const f = (t % 1.6) / 1.6;
      pulso.scale.setScalar(2 + f * 9);
      pulso.material.opacity = 0.85 * (1 - f);
    }
    procesarPuntero();
    renderer.render(escena, camara);
    actualizarPines();
    actualizarCajetin(h);
  }

  // ------------------------------------------------------------------ arranque
  function iniciar() {
    redimensionar();
    const v = vistaIsometrica();
    camara.position.copy(v.pos.clone().addScaledVector(SO, 120).setY(380));
    controles.target.copy(v.obj);
    camara.lookAt(controles.target);
    aplicarTema();
    renderLista();
    aplicarCapas();
    requestAnimationFrame(cuadro);
    volar(v.pos, v.obj, { dur: 2200 });
    setTimeout(() => {
      calcularCoberturaGlobal();
      const id = decodeURIComponent((location.hash || '').slice(1));
      if (porId[id]) seleccionar(porId[id]);
    }, 60);
  }

  const imagen = new Image();
  imagen.onload = () => {
    texSatelite = texturaSatelite(imagen);
    cargando.hidden = true;
    aplicarCapas();
  };
  imagen.onerror = () => {
    cargando.hidden = true;
    estado.capas.satelite = false;
    aplicarCapas();
  };
  if (window.SATELITE_CAMPUS) imagen.src = window.SATELITE_CAMPUS;
  else imagen.onerror();
  iniciar();
})();
