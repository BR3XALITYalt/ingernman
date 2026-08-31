
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const canvas = document.getElementById('game');
const ui = {
  caseNo: document.getElementById('caseNo'),
  score: document.getElementById('score'),
  status: document.getElementById('status'),
  hud: document.getElementById('hudText'),
  start: document.getElementById('startBtn'),
  pause: document.getElementById('pauseBtn'),
  secure: document.getElementById('secureBtn'),
  reset: document.getElementById('resetBtn')
};

const S = {
  x: 0, z: 0, target: new THREE.Vector3(35, 0, -28),
  score: 0, caseNo: 1, running: false, paused: false,
  keys: new Set(), last: performance.now(),
  moveX: 0, moveY: 0, lookYaw: 0
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071014);
scene.fog = new THREE.Fog(0x071014, 55, 150);

const camera = new THREE.PerspectiveCamera(52, 1, .1, 250);
camera.position.set(0, 11, 22);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

scene.add(new THREE.HemisphereLight(0x9bd8d0, 0x071014, 2));
const sun = new THREE.DirectionalLight(0xc9fff0, 3);
sun.position.set(-35, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

function mat(c) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: .9 })
}

function box(parent, x, y, z, w, h, d, c) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m
}

// ===== OPTIMIZATION 1: Spatial indexing for roads =====
const CHUNK_SIZE = 30, LOAD_RADIUS = 4, ACTIVE_RADIUS = 3;
const chunks = new Map();
const city = { roads: [], buildings: [] };

function hash2(x, z) {
  let n = (x * 374761393 + z * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296
}

const ROAD_NAMES = ['Main', 'Market', 'Oak', 'Pine', 'Cedar', 'Lincoln', 'Central', 'River', 'Park', 'Sunset', 'Liberty', 'Maple', 'Broadway', 'Union', 'First', 'Second', 'Franklin', 'Washington', 'Madison', 'Jefferson'];

// Word list for signs including Peter and Parker
const SIGN_WORDS = [
  'North', 'South', 'East', 'West', 'Upper', 'Lower', 'Old', 'New',
  'Grand', 'Little', 'High', 'Low', 'Middle', 'Center', 'Eastside',
  'Westside', 'Northend', 'Southend', 'Uptown', 'Downtown', 'Midtown',
  'Lake', 'River', 'Hill', 'Valley', 'Park', 'Garden', 'Forest',
  'Mountain', 'Meadow', 'Harbor', 'Beach', 'Bridge', 'Crossing',
  'Junction', 'Corner', 'Square', 'Plaza', 'Circle', 'Court',
  'Heights', 'Ridge', 'Point', 'View', 'Terrace', 'Lane', 'Drive',
  'Way', 'Path', 'Trail', 'Route', 'Pass', 'Gate', 'Door',
  'Spring', 'Summer', 'Autumn', 'Winter', 'Morning', 'Evening',
  'Sunrise', 'Sunset', 'Moonlight', 'Starlight', 'Daybreak', 'Twilight',
  'Peter', 'Parker'
];

function roadName(index, type) {
  const base = ROAD_NAMES[Math.abs(index | 0) % ROAD_NAMES.length];
  return `${base} ${type === 'freeway' ? 'Freeway' : type === 'boulevard' ? 'Blvd' : type === 'avenue' ? 'Avenue' : 'St'}`
}

function segmentDistance(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / (dx * dx + dz * dz || 1)));
  const x = x1 + dx * t, z = z1 + dz * t;
  return Math.hypot(px - x, pz - z)
}

function seeded(a, b, c = 0) {
  return hash2((a * 92821 + b * 68917 + c * 31337) | 0, (b * 19211 + c * 47297 + a * 8191) | 0)
}

function globalRoadSegments() {
  const roads = [];
  const addPolyline = (points, type, width, nameIndex) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i], [x2, z2] = points[i + 1];
      roads.push({
        x1, z1, x2, z2, type, width,
        color: type === 'freeway' ? 0x273337 : type === 'boulevard' ? 0x26363a : type === 'avenue' ? 0x202f33 : 0x1a292d,
        name: roadName(nameIndex + i, type)
      });
    }
  };

  for (let lane = -1; lane <= 1; lane++) {
    const pts = [];
    for (let x = -1800; x <= 1800; x += 30) {
      const z = lane * 92 + Math.sin(x / 78 + lane * .9) * 25 + Math.sin(x / 31 + lane) * 7;
      pts.push([x, z])
    }
    addPolyline(pts, lane === 0 ? 'boulevard' : 'avenue', lane === 0 ? 6.5 : 4.2, 20 + lane * 3)
  }

  for (let lane = -1; lane <= 1; lane++) {
    const pts = [];
    for (let z = -1800; z <= 1800; z += 30) {
      const x = lane * 115 + Math.sin(z / 91 + lane) * 30 + Math.sin(z / 37) * 8;
      pts.push([x, z])
    }
    addPolyline(pts, lane === 0 ? 'boulevard' : 'avenue', lane === 0 ? 6.2 : 4.0, 30 + lane * 4)
  }

  const freeway = [];
  for (let x = -1800; x <= 1800; x += 30) freeway.push([x, 150 + Math.sin(x / 115) * 32 + x * .08]);
  addPolyline(freeway, 'freeway', 9, 3);

  for (let row = -14; row <= 14; row++) {
    const base = row * 58 + Math.sin(row * 2.7) * 11;
    const pts = [];
    for (let x = -1800; x <= 1800; x += 30)
      pts.push([x, base + Math.sin(x / 43 + row) * 8 + Math.sin(x / 17 + row * 3) * 3]);
    addPolyline(pts, 'street', 3.1, 60 + row)
  }

  for (let col = -14; col <= 14; col++) {
    const base = col * 61 + Math.sin(col * 1.8) * 9;
    const pts = [];
    for (let z = -1800; z <= 1800; z += 30)
      pts.push([base + Math.sin(z / 47 + col) * 7 + Math.sin(z / 19) * 3, z]);
    addPolyline(pts, 'street', 3.0, 80 + col)
  }
  return roads
}

const WORLD_ROADS = globalRoadSegments();

// ===== OPTIMIZATION 2: Build spatial index for fast road queries =====
const roadGrid = new Map(); // Maps chunk coordinates to arrays of road indices

function buildRoadSpatialIndex() {
  roadGrid.clear();
  const GRID_CELL = CHUNK_SIZE;
  
  WORLD_ROADS.forEach((road, idx) => {
    const minX = Math.floor(Math.min(road.x1, road.x2) / GRID_CELL);
    const maxX = Math.floor(Math.max(road.x1, road.x2) / GRID_CELL);
    const minZ = Math.floor(Math.min(road.z1, road.z2) / GRID_CELL);
    const maxZ = Math.floor(Math.max(road.z1, road.z2) / GRID_CELL);
    
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = `${cx},${cz}`;
        if (!roadGrid.has(key)) roadGrid.set(key, []);
        roadGrid.get(key).push(idx);
      }
    }
  });
}

buildRoadSpatialIndex();

function getRoadsInChunk(cx, cz) {
  const key = `${cx},${cz}`;
  return roadGrid.get(key) || [];
}

function nearestRoadFast(x, z, searchRadius = 2) {
  const pcx = Math.floor(x / CHUNK_SIZE);
  const pcz = Math.floor(z / CHUNK_SIZE);
  let best = null;
  
  // Search nearby chunks only
  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dz = -searchRadius; dz <= searchRadius; dz++) {
      const roadIndices = getRoadsInChunk(pcx + dx, pcz + dz);
      if (!roadIndices) continue;
      
      for (const idx of roadIndices) {
        const r = WORLD_ROADS[idx];
        const distance = segmentDistance(x, z, r.x1, r.z1, r.x2, r.z2);
        if (!best || distance < best.distance) {
          best = { ...r, distance };
        }
      }
    }
  }
  return best;
}

function roadAt(x, z) {
  const r = nearestRoadFast(x, z);
  return !!(r && r.distance < r.width / 2 + 2.2);
}

// ===== OPTIMIZATION 3: Cache intersection detection =====
const intersectionCache = new Map();

function findIntersectionsForChunk(cx, cz) {
  const cacheKey = `${cx},${cz}`;
  if (intersectionCache.has(cacheKey)) {
    return intersectionCache.get(cacheKey);
  }
  
  const intersections = [];
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const halfSize = CHUNK_SIZE / 2 + 4;
  
  // Get relevant roads for this chunk
  const relevantRoadIndices = new Set();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const indices = getRoadsInChunk(cx + dx, cz + dz);
      if (indices) indices.forEach(i => relevantRoadIndices.add(i));
    }
  }
  
  const relevantRoads = Array.from(relevantRoadIndices).map(i => WORLD_ROADS[i]);
  
  // Only check non-street vs street/non-street combinations
  const majorRoads = relevantRoads.filter(r => r.type !== 'street');
  const allRoads = relevantRoads;
  
  for (const a of majorRoads) {
    for (const b of allRoads) {
      if (a === b) continue;
      
      const ax = a.x2 - a.x1, az = a.z2 - a.z1;
      const bx = b.x2 - b.x1, bz = b.z2 - b.z1;
      const den = ax * bz - az * bx;
      
      if (Math.abs(den) < .001) continue;
      
      const t = ((b.x1 - a.x1) * bz - (b.z1 - a.z1) * bx) / den;
      const u = ((b.x1 - a.x1) * az - (b.z1 - a.z1) * ax) / den;
      
      if (t < .05 || t > .95 || u < .05 || u > .95) continue;
      
      const ix = a.x1 + t * ax;
      const iz = a.z1 + t * az;
      
      if (Math.abs(ix - ox) > halfSize || Math.abs(iz - oz) > halfSize) continue;
      
      intersections.push({ x: ix, z: iz, roadA: a, roadB: b });
    }
  }
  
  intersectionCache.set(cacheKey, intersections);
  return intersections;
}

// Helper function to generate a street name with random prefix and ABBREVIATED road type
function generateStreetName(baseRoadName, type) {
  const randomWord = SIGN_WORDS[Math.floor(Math.random() * SIGN_WORDS.length)];
  const typeSuffix = type === 'freeway' ? 'Fwy' : 
                     type === 'boulevard' ? 'Blvd' : 
                     type === 'avenue' ? 'Ave' : 'St';
  
  return `${randomWord} ${baseRoadName} ${typeSuffix}`;
}

// Updated addSign function with dynamic sizing
function addSign(g, x, z, text, rot) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.5, 6), mat(0x697477));
  pole.position.set(x, .75, z);
  g.add(pole);
  
  // Measure text to determine sign width
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = 'bold 20px Arial';
  const metrics = ctx.measureText(text);
  const textWidthPx = metrics.width;
  
  // Calculate sign dimensions based on text width
  // Base width 1.45 corresponds to ~18 chars. Scale accordingly.
  const baseCharWidth = 1.45 / 18; 
  let signWidth = Math.max(1.45, textWidthPx * 0.08); // 0.08 is a scaling factor from px to world units
  signWidth = Math.min(signWidth, 3.5); // Cap max width
  
  const signHeight = 0.34;
  const signDepth = 0.05;
  
  const sign = new THREE.Mesh(new THREE.BoxGeometry(signWidth, signHeight, signDepth), mat(0x24523e));
  sign.position.set(x, 1.45, z);
  sign.rotation.y = rot;
  g.add(sign);
  
  // Create texture with appropriate resolution
  const texWidth = Math.ceil(textWidthPx) + 20; // Add padding
  const texHeight = 64;
  const c = document.createElement('canvas');
  c.width = texWidth;
  c.height = texHeight;
  const sctx = c.getContext('2d');
  sctx.fillStyle = '#fff';
  sctx.font = 'bold 20px Arial';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText(text, texWidth / 2, texHeight / 2);
  
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(signWidth - 0.15, signHeight - 0.04), // Slightly smaller than sign box
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
  );
  plate.position.set(x, 1.45, z + (rot === 0 || rot === Math.PI ? 0.03 : 0) ); // Offset slightly forward
  // Adjust plate rotation to match sign but face correct way relative to sign normal
  plate.rotation.y = rot;
  // Push plate slightly out from sign face
  const offset = signDepth / 2 + 0.01;
  plate.position.x += Math.sin(rot) * offset;
  plate.position.z += Math.cos(rot) * offset;
  
  g.add(plate);
}

function addRoad(g, r, ox, oz) {
  const dx = r.x2 - r.x1, dz = r.z2 - r.z1;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, .09, r.width), mat(r.color));
  m.position.set((r.x1 + r.x2) / 2, .045, (r.z1 + r.z2) / 2);
  m.rotation.y = -Math.atan2(dz, dx);
  g.add(m);
  city.roads.push(r)
}

// Add a building spatial index for faster lookups
const buildingGrid = new Map();

function addToBuildingGrid(building) {
  const cx = Math.floor(building.x / CHUNK_SIZE);
  const cz = Math.floor(building.z / CHUNK_SIZE);
  const key = `${cx},${cz}`;
  
  if (!buildingGrid.has(key)) {
    buildingGrid.set(key, []);
  }
  buildingGrid.get(key).push(building);
}

// Optimized position check using spatial grid
function isPositionClearFast(x, z, minDistance = 3) {
  const pcx = Math.floor(x / CHUNK_SIZE);
  const pcz = Math.floor(z / CHUNK_SIZE);
  const searchRadius = Math.ceil(minDistance / CHUNK_SIZE) + 1;
  
  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dz = -searchRadius; dz <= searchRadius; dz++) {
      const key = `${pcx + dx},${pcz + dz}`;
      const buildings = buildingGrid.get(key);
      
      if (buildings) {
        for (const b of buildings) {
          const distX = Math.abs(x - b.x);
          const distZ = Math.abs(z - b.z);
          if (distX < (b.w / 2 + minDistance) && distZ < (b.d / 2 + minDistance)) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

function buildChunk(cx, cz) {
  const key = `${cx},${cz}`;
  if (chunks.has(key)) return chunks.get(key);
  
  const g = new THREE.Group();
  g.userData = { cx, cz };
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x0b191d, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ox, 0, oz);
  floor.receiveShadow = true;
  g.add(floor);
  
  // Use spatial index for faster road lookup
  const chunkRoadIndices = getRoadsInChunk(cx, cz);
  if (chunkRoadIndices) {
    for (const idx of chunkRoadIndices) {
      const r = WORLD_ROADS[idx];
      const minX = Math.min(r.x1, r.x2) - r.width;
      const maxX = Math.max(r.x1, r.x2) + r.width;
      const minZ = Math.min(r.z1, r.z2) - r.width;
      const maxZ = Math.max(r.z1, r.z2) + r.width;
      
      if (maxX >= ox - CHUNK_SIZE / 2 && minX <= ox + CHUNK_SIZE / 2 &&
          maxZ >= oz - CHUNK_SIZE / 2 && minZ <= oz + CHUNK_SIZE / 2) {
        addRoad(g, r, ox, oz);
      }
    }
  }
  
  const local = [];
  
  // Building placement with spatial optimization
  for (let i = 0; i < 28; i++) {
    const x = ox - CHUNK_SIZE / 2 + 2 + seeded(cx, cz, i) * (CHUNK_SIZE - 4);
    const z = oz - CHUNK_SIZE / 2 + 2 + seeded(cz, cx, i + 77) * (CHUNK_SIZE - 4);
    
    // Use fast road query
    const r = nearestRoadFast(x, z);
    if (r && r.distance < r.width / 2 + 3.5) continue;
    
    const w = 4.5 + seeded(cx, cz, i + 11) * 7;
    const d = 4.5 + seeded(cz, cx, i + 29) * 7;
    const h = 3.5 + Math.floor(seeded(cx, cz, i + 41) * 7) * 2;
    
    const corners = [
      [x - w / 2 - 1, z - d / 2 - 1],
      [x + w / 2 + 1, z - d / 2 - 1],
      [x - w / 2 - 1, z + d / 2 + 1],
      [x + w / 2 + 1, z + d / 2 + 1]
    ];
    
    if (corners.some(([px, pz]) => {
      const rr = nearestRoadFast(px, pz);
      return rr && rr.distance < rr.width / 2 + 1.2;
    })) continue;
    
    if (local.some(b => Math.abs(b.x - x) < (b.w + w) / 2 + 1.2 && 
                        Math.abs(b.z - z) < (b.d + d) / 2 + 1.2)) continue;
    
    const b = { x, z, w, d, h };
    box(g, x, 0, z, w, h, d, h >= 14 ? 0x2a4549 : h >= 9 ? 0x21393d : 0x1a3034);
    local.push(b);
    city.buildings.push(b);
    
    // Register building in spatial grid
    addToBuildingGrid(b);
    
    if (h >= 12) box(g, x, h, z, w * .35, .8, d * .35, 0x304c50);
  }
  
  // Use cached intersections for signs
  const intersections = findIntersectionsForChunk(cx, cz);
  const placedSigns = new Set();
  
  for (const inter of intersections) {
    const key = Math.round(inter.x) + ',' + Math.round(inter.z);
    if (placedSigns.has(key)) continue;
    placedSigns.add(key);
    
    // Generate unique names for each intersection
    const nameA = generateStreetName(inter.roadA.name, inter.roadA.type);
    const nameB = generateStreetName(inter.roadB.name, inter.roadB.type);

    addSign(g, inter.x + 1.4, inter.z + 1.4, nameA, 
            Math.atan2(inter.roadA.x2 - inter.roadA.x1, inter.roadA.z2 - inter.roadA.z1));
    addSign(g, inter.x - 1.4, inter.z - 1.4, nameB,
            Math.atan2(inter.roadB.x2 - inter.roadB.x1, inter.roadB.z2 - inter.roadB.z1));
  }
  
  scene.add(g);
  chunks.set(key, g);
  return g
}

// Batch geometry/material disposal for better performance
function disposeChunk(g) {
  const geometries = new Set();
  const materials = new Set();
  
  g.traverse(obj => {
    if (obj.geometry) geometries.add(obj.geometry);
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => materials.add(m));
      } else {
        materials.add(obj.material);
      }
    }
  });
  
  geometries.forEach(geo => geo.dispose());
  materials.forEach(mat => {
    if (mat.map) mat.map.dispose();
    mat.dispose();
  });
}

function updateChunks() {
  const pcx = Math.floor(S.x / CHUNK_SIZE);
  const pcz = Math.floor(S.z / CHUNK_SIZE);
  const keep = new Set();
  
  for (let x = pcx - LOAD_RADIUS; x <= pcx + LOAD_RADIUS; x++) {
    for (let z = pcz - LOAD_RADIUS; z <= pcz + LOAD_RADIUS; z++) {
      if (Math.hypot(x - pcx, z - pcz) <= LOAD_RADIUS + 0.5) {
        const g = buildChunk(x, z);
        keep.add(`${x},${z}`);
      }
    }
  }
  
  // Hide distant chunks and batch dispose
  const toRemove = [];
  for (const [key, g] of chunks) {
    const dx = g.userData.cx - pcx;
    const dz = g.userData.cz - pcz;
    const dist = Math.hypot(dx, dz);
    
    if (dist > LOAD_RADIUS + 1) {
      g.visible = false;
      toRemove.push({ key, g });
      continue;
    }
    g.visible = dist <= ACTIVE_RADIUS + 1;
  }
  
  // Batch removal
  for (const { key, g } of toRemove) {
    disposeChunk(g);
    scene.remove(g);
    chunks.delete(key);
  }
  
  // Camera-facing visibility pass
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  
  for (const g of chunks.values()) {
    if (!g.visible) continue;
    
    const center = new THREE.Vector3(g.userData.cx * CHUNK_SIZE, 0, g.userData.cz * CHUNK_SIZE);
    const to = center.sub(camera.position);
    const distance = to.length();
    
    if (distance > CHUNK_SIZE * 1.5) {
      to.normalize();
      g.visible = forward.dot(to) > -0.15;
    }
  }
}

updateChunks();

const character = new THREE.Group();
scene.add(character);
const car = character;
let ingermanModel = null;

import('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
  new GLTFLoader().load('/assets/ingerman.glb', g => {
    ingermanModel = g.scene;
    ingermanModel.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    
    const bounds = new THREE.Box3().setFromObject(ingermanModel);
    const size = bounds.getSize(new THREE.Vector3());
    const height = Math.max(size.y, 0.001);
    const scale = 2.0 / height;
    
    ingermanModel.scale.setScalar(scale);
    const scaledBounds = new THREE.Box3().setFromObject(ingermanModel);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    
    ingermanModel.position.x -= center.x;
    ingermanModel.position.z -= center.z;
    const grounded = new THREE.Box3().setFromObject(ingermanModel);
    ingermanModel.position.y -= grounded.min.y;
    
    character.add(ingermanModel);
  }).catch(err => console.error('Ingerman GLB failed to load', err));
}).catch(err => console.error('GLTFLoader failed to load', err));

const target = new THREE.Mesh(
  new THREE.CylinderGeometry(1.1, .15, 2.2, 24),
  new THREE.MeshStandardMaterial({
    color: 0x65e89a, emissive: 0x65e89a,
    emissiveIntensity: 1.5, transparent: true, opacity: .8
  })
);
target.position.copy(S.target);
target.position.y = 1.1;
scene.add(target);

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(2.1, .09, 10, 40),
  new THREE.MeshBasicMaterial({ color: 0x8ff0ae })
);
ring.rotation.x = Math.PI / 2;
ring.position.copy(S.target);
ring.position.y = .15;
scene.add(ring);

const INCIDENT_MIN = 18, INCIDENT_MAX = 42;

// Updated newTarget function with building collision avoidance
function newTarget() {
  let attempts = 0;
  const maxAttempts = 50;
  
  do {
    const a = Math.random() * Math.PI * 2;
    const r = INCIDENT_MIN + Math.random() * (INCIDENT_MAX - INCIDENT_MIN);
    S.target.set(
      Math.round((S.x + Math.cos(a) * r) / 3) * 3,
      0,
      Math.round((S.z + Math.sin(a) * r) / 3) * 3
    );
    attempts++;
    
    // Use fast spatial check
    if (isPositionClearFast(S.target.x, S.target.z, 4)) {
      break;
    }
  } while (attempts < maxAttempts);
  
  // Fallback with expanded search
  if (attempts >= maxAttempts) {
    console.warn('Could not find clear incident location, expanding search');
    const expandedRadius = INCIDENT_MAX * 1.5;
    attempts = 0;
    do {
      const a = Math.random() * Math.PI * 2;
      const r = INCIDENT_MIN + Math.random() * (expandedRadius - INCIDENT_MIN);
      S.target.set(
        Math.round((S.x + Math.cos(a) * r) / 3) * 3,
        0,
        Math.round((S.z + Math.sin(a) * r) / 3) * 3
      );
      attempts++;
    } while (!isPositionClearFast(S.target.x, S.target.z, 4) && attempts < 30);
  }
  
  target.position.set(S.target.x, 1.1, S.target.z);
  ring.position.set(S.target.x, .15, S.target.z);
}

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
  camera.aspect = Math.max(.1, r.width / r.height);
  camera.updateProjectionMatrix();
}

addEventListener('resize', resize);
resize();

function start() {
  S.running = true;
  S.paused = false;
  ui.status.textContent = 'Patrol started. Locate the green incident marker.';
  ui.hud.textContent = 'PATROL ACTIVE';
}

function pause() {
  if (!S.running) return;
  S.paused = !S.paused;
  ui.pause.textContent = S.paused ? 'Resume' : 'Pause';
  ui.status.textContent = S.paused ? 'Patrol paused.' : 'Patrol resumed.';
  ui.hud.textContent = S.paused ? 'PATROL PAUSED' : 'PATROL ACTIVE';
}

function secure() {
  if (!S.running || S.paused) return;
  const d = Math.hypot(S.x - S.target.x, S.z - S.target.z);
  if (d < 5) {
    S.score += 100;
    S.caseNo++;
    newTarget();
    ui.score.textContent = String(S.score).padStart(6, '0');
    ui.caseNo.textContent = String(S.caseNo).padStart(2, '0');
    ui.status.textContent = 'Scene secured. New incident dispatched.';
    ui.hud.textContent = 'NEW INCIDENT';
  } else {
    ui.status.textContent = 'Too far away. Get closer to the green marker.';
  }
}

function reset() {
  S.x = 0;
  S.z = 0;
  S.score = 0;
  S.caseNo = 1;
  S.running = false;
  S.paused = false;
  S.moveX = 0;
  S.moveY = 0;
  S.lookYaw = 0;
  newTarget();
  car.position.set(0, 0, 0);
  car.rotation.y = 0;
  ui.score.textContent = '000000';
  ui.caseNo.textContent = '01';
  ui.pause.textContent = 'Pause';
  ui.status.textContent = 'Start your patrol.';
  ui.hud.textContent = 'PATROL STANDBY';
  centerCamera(true);
}

const keyMap = {
  KeyW: 'w', KeyA: 'right', KeyS: 's', KeyD: 'left',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'right', ArrowRight: 'left'
};

addEventListener('keydown', e => {
  if (keyMap[e.code]) {
    e.preventDefault();
    S.keys.add(keyMap[e.code]);
  }
});

addEventListener('keyup', e => {
  if (keyMap[e.code]) S.keys.delete(keyMap[e.code]);
});

ui.start.onclick = start;
ui.pause.onclick = pause;
ui.secure.onclick = secure;
ui.reset.onclick = reset;

const joy = document.getElementById('joystick');
const stick = document.getElementById('stick');
let joyPointer = null;

function updateJoy(e) {
  if (joyPointer === null) return;
  const r = joy.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const max = r.width * .34;
  let x = e.clientX - cx, y = e.clientY - cy;
  const d = Math.hypot(x, y);
  if (d > max) {
    x = x / d * max;
    y = y / d * max;
  }
  S.moveX = x / max;
  S.moveY = y / max;
  stick.style.transform = `translate(${x}px,${y}px)`;
}

function endJoy(e) {
  if (e.pointerId !== joyPointer) return;
  joyPointer = null;
  S.moveX = S.moveY = 0;
  stick.style.transform = 'translate(0,0)';
  try {
    joy.releasePointerCapture(e.pointerId);
  } catch {}
}

if (joy) {
  joy.addEventListener('pointerdown', e => {
    e.preventDefault();
    joyPointer = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    updateJoy(e);
  });
  joy.addEventListener('pointermove', e => {
    e.preventDefault();
    updateJoy(e);
  });
  joy.addEventListener('pointerup', endJoy);
  joy.addEventListener('pointercancel', endJoy);
}

let lookPointer = null, lastLookX = 0, lastLookY = 0;
const lookEl = canvas;
canvas.style.touchAction = 'none';
lookEl.addEventListener('contextmenu', e => e.preventDefault());

lookEl.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 2) return;
  if (e.pointerType === 'touch' && e.clientY > canvas.getBoundingClientRect().bottom - 8) return;
  e.preventDefault();
  lookPointer = e.pointerId;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  lookEl.setPointerCapture?.(e.pointerId);
});

lookEl.addEventListener('pointermove', e => {
  if (e.pointerId !== lookPointer) return;
  e.preventDefault();
  const dx = e.clientX - lastLookX;
  const dy = e.clientY - lastLookY;
  S.lookYaw += dx * .008;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
});

const endLook = e => {
  if (e.pointerId === lookPointer) {
    lookPointer = null;
    try {
      lookEl.releasePointerCapture?.(e.pointerId);
    } catch {}
  }
};

lookEl.addEventListener('pointerup', endLook);
lookEl.addEventListener('pointercancel', endLook);

function centerCamera(force = false) {
  const followDistance = 8, followHeight = 4.2;
  const yaw = S.lookYaw;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const x = S.x - sin * followDistance, z = S.z - cos * followDistance;
  
  if (force) {
    camera.position.set(x, followHeight, z);
  } else {
    const b = 1 - Math.exp(-7 * ((performance.now() - S.last) / 1000));
    camera.position.x += (x - camera.position.x) * b;
    camera.position.y += (followHeight - camera.position.y) * b;
    camera.position.z += (z - camera.position.z) * b;
  }
  camera.lookAt(S.x + sin * 4, 1.05, S.z + cos * 4);
}

const mini = document.getElementById('minimap');
const mctx = mini?.getContext('2d');

// ===== OPTIMIZATION 4: Minimap with frustum culling =====
function drawMinimap() {
  if (!mctx) return;
  
  const w = mini.width, h = mini.height;
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = 'rgba(5,12,15,.96)';
  mctx.fillRect(0, 0, w, h);
  
  const range = 180;
  const scale = Math.min(w, h) / (range * 2);
  const map = (x, z) => [w / 2 - (x - S.x) * scale, h / 2 - (z - S.z) * scale];
  
  // Only render roads in visible range
  const minX = S.x - range;
  const maxX = S.x + range;
  const minZ = S.z - range;
  const maxZ = S.z + range;
  
  for (const r of WORLD_ROADS) {
    const rminx = Math.min(r.x1, r.x2);
    const rmaxx = Math.max(r.x1, r.x2);
    const rminz = Math.min(r.z1, r.z2);
    const rmaxz = Math.max(r.z1, r.z2);
    
    if (rmaxx < minX || rminx > maxX || rmaxz < minZ || rminz > maxZ) continue;
    
    const [x1, y1] = map(r.x1, r.z1);
    const [x2, y2] = map(r.x2, r.z2);
    
    mctx.strokeStyle = r.type === 'freeway' ? '#657477' :
                       r.type === 'boulevard' ? '#829093' :
                       r.type === 'avenue' ? '#5e7074' : '#4c5c60';
    mctx.lineWidth = Math.max(1.5, r.width * scale);
    mctx.beginPath();
    mctx.moveTo(x1, y1);
    mctx.lineTo(x2, y2);
    mctx.stroke();
  }
  
  mctx.fillStyle = 'rgba(23,40,45,.86)';
  for (const b of city.buildings) {
    if (Math.abs(b.x - S.x) > range + 10 || Math.abs(b.z - S.z) > range + 10) continue;
    const [x, y] = map(b.x, b.z);
    mctx.fillRect(x - b.w * scale / 2, y - b.d * scale / 2, b.w * scale, b.d * scale);
  }
  
  const [tx, tz] = map(S.target.x, S.target.z);
  mctx.fillStyle = '#65e89a';
  mctx.beginPath();
  mctx.arc(tx, tz, 5, 0, Math.PI * 2);
  mctx.fill();
  
  mctx.save();
  mctx.translate(w / 2, h / 2);
  mctx.rotate(-car.rotation.y);
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  mctx.moveTo(0, -9);
  mctx.lineTo(6, 7);
  mctx.lineTo(0, 4);
  mctx.lineTo(-6, 7);
  mctx.closePath();
  mctx.fill();
  mctx.restore();
  
  mctx.fillStyle = 'rgba(255,255,255,.7)';
  mctx.font = 'bold 9px Arial';
  mctx.fillText('N', w / 2 - 3, 11);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - S.last) / 1000, .05);
  S.last = now;
  
  if (S.running && !S.paused) {
    let dx = 0, dz = 0;
    if (S.keys.has('a') || S.keys.has('left')) dx--;
    if (S.keys.has('d') || S.keys.has('right')) dx++;
    if (S.keys.has('w') || S.keys.has('up')) dz--;
    if (S.keys.has('s') || S.keys.has('down')) dz++;
    
    dx -= S.moveX;
    dz += S.moveY;
    
    const len = Math.hypot(dx, dz);
    if (len > .08) {
      dx /= Math.max(1, len);
      dz /= Math.max(1, len);
      
      const speed = 18;
      const yaw = S.lookYaw;
      const wx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const wz = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
      
      S.x += wx * speed * dt;
      S.z += wz * speed * dt;
      car.rotation.y = Math.atan2(wx, wz);
      car.position.set(S.x, 0, S.z);
    }
    
    const d = Math.hypot(S.x - S.target.x, S.z - S.target.z);
    ui.status.textContent = d < 5 ? 'Incident reached — secure the scene.' : 'Navigate to the green incident marker.';
    ui.hud.textContent = d < 5 ? 'INCIDENT IN RANGE' : 'PATROL ACTIVE';
  }
  
  target.rotation.y += dt * 1.8;
  const pulse = 1 + Math.sin(now * .004) * .12;
  target.scale.setScalar(pulse);
  ring.scale.setScalar(1 + Math.sin(now * .003) * .08);
  
  centerCamera();
  updateChunks();
  drawMinimap();
  renderer.render(scene, camera);
}

requestAnimationFrame(loop);
