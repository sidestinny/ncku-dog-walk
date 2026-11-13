// =====================================================
//  成功校區遛狗範圍 3D 地圖
//  綠色＝可以走、紅色＝不能去；可以用 GPS 看自己的位置
// =====================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DATA = window.CAMPUS_DATA;               // data.js：從 OpenStreetMap 轉換的建築和道路
const [LAT0, LON0] = DATA.origin;
const $ = (id) => document.getElementById(id);

// =====================================================
//  範圍設定（單位：公尺；x 往東、y 往南）
//  之後要調整範圍，改這一段就好
// =====================================================

// 成功校區四個角（四條馬路中心線的交叉點）：西北、東北、東南、西南
const CAMPUS = [[-146, -303], [238, -274], [198, 245], [-186, 215]];
const ROAD_HALF = 8;                            // 從馬路中心線往校內 8 公尺，才算進到校園


// 不能去的地方（參考中途白板地圖，和遊戲裡確認過的範圍）
const NO_GO = [
  // 北邊：數學、測量系館南邊那條東西向車道（含資訊大樓北邊、往勝利路那段）以北，以及材料系館（含）以北
  // 邊界沿著車道的北側路邊，車道本身可以走
  [[-300, -450], [350, -450], [350, -10], [48, -10], [47.5, -15.5], [-36, -21.5], [-86, -25.5],
   [-101, -27.5], [-162, -32.5], [-300, -32.5]],
  // 三系館鋼構區、資源工程系大樓、資訊工程系大樓這一排，加上東側到長榮路（到長榮路側門車道之前為止）
  // 西邊界跟工學大道平行
  [[153, -10], [350, -10], [350, 142], [141, 142]],
  // 理學院路以西整片（資訊大樓、理化實驗大樓、地球科學系館、綜合二館、綜合大樓那一排）
  // 北邊界沿著資訊大樓北邊車道的南側路邊、東邊界沿著理學院路的西側路邊，兩條路本身都可以走
  [[-300, -19], [-162, -23.5], [-101, -18.5], [-90.5, -16.6], [-93.5, 14], [-96.5, 58], [-100.5, 114],
   [-104.5, 163], [-108.5, 211], [-109.5, 240], [-300, 240]],
  // 格致堂和博物館之間：一條紅色直線（寬 6 公尺），從理學院路畫到工學大道，跟道路平行
  [[-93.7, 139.2], [25.5, 148.5], [25.1, 154.5], [-94.1, 145.2]],
];
// （白板上數學系館西側打叉的地方，已經包含在「紅色虛線以北」和「靠勝利路」的範圍裡）

// 中途：博物館前面的廣場（南榕廣場）、靠中間工學大道的地方
const HOME = { x: 6, y: 214 };

// 建築的名字、位置、形狀都來自成大官方地理資訊系統（data.js）
// 字擠在一起時，優先顯示這些主要系館的名字
const MAIN = new Set(['圖書館', '數學系館', '測量系館', '化學系館', '物理系館', '格致堂', '博物館', '資訊大樓',
  '理化實驗大樓', '地球科學系館', '綜合二館', '綜合大樓', '材料工程系館', '材料工程系大樓', '資源工程系館',
  '資源工程系大樓', '資訊工程系館', '資訊工程系大樓', '工程科學系館', '工程科學系館(舊機械系館)']);

// =====================================================
//  幾何小工具
// =====================================================
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
// 點 p 在邊 a→b 的哪一側（正數＝校園內側），單位：公尺
const sideDist = (p, a, b) => cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);

function lineInter(p, d, q, e) {
  const t = cross(q[0] - p[0], q[1] - p[1], e[0], e[1]) / cross(d[0], d[1], e[0], e[1]);
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

// 把凸多邊形往內縮 m 公尺
function insetPoly(poly, m) {
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return { p: [a[0] - d[1] * m, a[1] + d[0] * m], d };
  });
  return lines.map((L, i) => {
    const P = lines[(i - 1 + lines.length) % lines.length];
    return lineInter(P.p, P.d, L.p, L.d);
  });
}

// 用凸多邊形 clip 把 subject 裁切（只留在校園裡的部分）
function clipPoly(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length];
      const dp = sideDist(P, a, b), dq = sideDist(Q, a, b);
      if (dp >= 0) out.push(P);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  return out;
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
}
function polyEdgeDist(x, y, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(x, y, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

const CAMPUS_IN = insetPoly(CAMPUS, ROAD_HALF);                       // 校園範圍（扣掉馬路）
const NO_GO_IN = NO_GO.map((p) => clipPoly(p, CAMPUS_IN)).filter((p) => p.length >= 3);
// 所有建築：OpenStreetMap 的＋補上的；整理好名字，只留下成功校區裡面的
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const inQuad = (x, y) => CAMPUS.every((a, i) => sideDist([x, y], a, CAMPUS[(i + 1) % CAMPUS.length]) >= 0);
const polyArea = (p) => Math.abs(p.reduce((s, q, i) => s + p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1], 0)) / 2;
// 地圖資料裡少畫的路（依隊員說明補上）
DATA.paths.push(
  // 長榮路側門車道 ↔ 資訊系館和工科系館之間的路，實際上是連在一起的
  { t: 'footway', n: '', p: [[158, 148], [165, 150], [171, 152.5]] },
);

// 位置要修正的建築（官方資料和實際不同，依隊員說明調整）
const POSITION_FIX = {
  // 警衛室：在工科系館和大學路之間、工學大道旁邊（東側）
  B083: [[31, 206], [41, 206.8], [40.3, 216], [30.3, 215.2]],
};
const BUILDINGS = DATA.buildings.map((b) => {
  if (POSITION_FIX[b.i]) b = { ...b, p: POSITION_FIX[b.i] };
  const [cx, cy] = centroid(b.p);
  return { ...b, cx, cy, name: b.n, area: polyArea(b.p), inCampus: inQuad(cx, cy) };
}).filter((b) => b.inCampus);                   // 成功校區以外的建築不畫

// =====================================================
//  判斷某個位置能不能走
// =====================================================
function classify(x, y) {
  const inCampus = CAMPUS_IN.every((a, i) => sideDist([x, y], a, CAMPUS_IN[(i + 1) % CAMPUS_IN.length]) >= 0);
  if (!inCampus) return { level: 'bad', main: '🚫 這裡在成功校區外面', sub: '不可以過馬路喔！請回到校園裡。' };
  if (NO_GO_IN.some((p) => inPoly(x, y, p))) {
    return { level: 'bad', main: '⚠️ 這裡不在遛狗範圍內', sub: '請往回走，回到綠色的地方。' };
  }
  const bld = BUILDINGS.find((b) => inPoly(x, y, b.p));
  if (bld) return buildingResult(bld);
  // 離最近的邊界多遠
  let d = polyEdgeDist(x, y, CAMPUS_IN);
  NO_GO_IN.forEach((p) => { d = Math.min(d, polyEdgeDist(x, y, p)); });
  if (d < 10) return { level: 'warn', main: '🟡 快到範圍邊界了', sub: `離不能去的地方大約 ${Math.max(1, Math.round(d))} 公尺，注意別走出去。` };
  return { level: 'ok', main: '✅ 在遛狗範圍內', sub: `離最近的邊界大約 ${Math.round(d)} 公尺。` };
}

function buildingResult(b) {
  const name = b.name || '建築';
  return { level: 'warn', main: `🏢 這裡是${name}`, sub: '系館不能進去喔（如果你在外面，可能是 GPS 誤差）。' };
}

const fromLatLon = (lat, lon) => ({ x: (lon - LON0) * DATA.kx, y: -(lat - LAT0) * DATA.ky });

// =====================================================
//  3D 場景
// =====================================================
const container = $('map');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dfe7d6');
scene.fog = new THREE.Fog('#dfe7d6', 1100, 2200);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.screenSpacePanning = false;       // 平移時沿著地面移動
controls.maxPolarAngle = Math.PI * 0.44;   // 不要轉到地面下
controls.minDistance = 40;
controls.maxDistance = 1500;

const AREA_CENTER = new THREE.Vector3(15, 0, 95);   // 遛狗範圍的中心附近
const VIEW_3D = new THREE.Vector3(0, 420, 470);     // 3D 視角：相機和目標的距離
const VIEW_TOP = new THREE.Vector3(0, 640, 1);      // 俯視
controls.target.copy(AREA_CENTER);
camera.position.copy(AREA_CENTER).add(VIEW_3D);

scene.add(new THREE.HemisphereLight('#ffffff', '#a8a890', 1.0));
const sun = new THREE.DirectionalLight('#ffffff', 0.9);
sun.position.set(-250, 500, 200);
scene.add(sun);

// 平面圖形：地圖上的 (x, y) → 3D 的 (x, 高度, y)
const shapeOf = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
function addFlat(pts, color, height, opts = {}) {
  const geo = new THREE.ShapeGeometry(shapeOf(pts));
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...opts });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height;
  scene.add(mesh);
  return mesh;
}
function addLine(pts, color, height, dashed = false, closed = true) {
  const arr = pts.map(([x, y]) => new THREE.Vector3(x, height, y));
  if (closed) arr.push(arr[0].clone());
  const geo = new THREE.BufferGeometry().setFromPoints(arr);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 5, gapSize: 4 })
    : new THREE.LineBasicMaterial({ color });
  const line = new THREE.Line(geo, mat);
  if (dashed) line.computeLineDistances();
  scene.add(line);
  return line;
}

// 地面（校外，什麼都不畫）
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#d9dcd2' }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// 四條馬路：灰色路面＋白色虛線（長榮路是雙向分開的兩條，所以每條窄一點）
const ROAD_WIDTH = { '小東路': 18, '勝利路': 14, '大學路': 15, '長榮路三段': 10, '長榮路四段': 10 };
DATA.roads.forEach((r) => {
  const arr = [];
  const w = ROAD_WIDTH[r.n] || 12;
  for (let i = 0; i < r.p.length - 1; i++) pushQuad(arr, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], w);
  r.p.forEach(([x, y]) => pushDisc(arr, x, y, w / 2));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const road = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#8f9188', side: THREE.DoubleSide }));
  road.position.y = 0.08;
  scene.add(road);
  addLine(r.p, '#ffffff', 0.15, true, false);
});

// 校園（可以走的地方先全部塗綠色）
addFlat(CAMPUS_IN, '#bfe3a0', 0.2);
addLine(CAMPUS_IN, '#5e9b44', 0.35);

// 不能去的地方：紅色＋紅色虛線外框
NO_GO_IN.forEach((p) => {
  addFlat(p, '#f3a5a5', 0.3);
  addLine(p, '#d93a33', 0.6, true);
});


// 草地、公園、水池（草地放在紅色下面，水池放在上面）
(DATA.areas || []).forEach((a) => {
  if (a.p.length < 3 || !inQuad(...centroid(a.p))) return;      // 校外的不畫
  if (a.t === 'water') addFlat(a.p, '#7cc4e8', 0.36);
  else addFlat(a.p, '#a5d77f', 0.25);
});

// =====================================================
//  步道和校內道路（像寶可夢 GO 一樣畫在地上）
//  可以走的路：奶油色＋綠邊；不能去的路：淡紅色；成功校區外面的不畫
// =====================================================
const PATH_WIDTH = { service: 6, pedestrian: 5, living_street: 5, track: 3.5, footway: 3.2, cycleway: 3, path: 2.6, steps: 2.6 };
const PATH_STYLE = {
  ok: { fill: '#fffbe0', edge: '#2e7d32' },
  no: { fill: '#f8d0d0', edge: '#c75b5b' },
};
function zoneOf(x, y) {
  if (!inQuad(x, y)) return 'out';             // 成功校區外面
  const inCampus = CAMPUS_IN.every((a, i) => sideDist([x, y], a, CAMPUS_IN[(i + 1) % CAMPUS_IN.length]) >= 0);
  if (!inCampus) return 'no';                   // 馬路邊（人行道）
  if (NO_GO_IN.some((p) => inPoly(x, y, p))) return 'no';
  return 'ok';
}
// 把一段一段的路，變成地上的「帶子」（三角形）
const ribbon = { ok: { fill: [], edge: [] }, no: { fill: [], edge: [] } };
function pushQuad(arr, x1, y1, x2, y2, w) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * w / 2, ny = ((x2 - x1) / len) * w / 2;
  arr.push(x1 + nx, 0, y1 + ny, x1 - nx, 0, y1 - ny, x2 - nx, 0, y2 - ny,
           x1 + nx, 0, y1 + ny, x2 - nx, 0, y2 - ny, x2 + nx, 0, y2 + ny);
}
function pushDisc(arr, x, y, r) {             // 轉角補一個小圓，路才不會斷開
  const n = 10;
  for (let k = 0; k < n; k++) {
    const a1 = (k / n) * Math.PI * 2, a2 = ((k + 1) / n) * Math.PI * 2;
    arr.push(x, 0, y, x + Math.cos(a2) * r, 0, y + Math.sin(a2) * r, x + Math.cos(a1) * r, 0, y + Math.sin(a1) * r);
  }
}
(DATA.paths || []).forEach((path) => {
  const w = PATH_WIDTH[path.t] || 3;
  for (let i = 0; i < path.p.length - 1; i++) {
    const [ax, ay] = path.p[i], [bx, by] = path.p[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));   // 每 4 公尺判斷一次在哪一區
    for (let s = 0; s < steps; s++) {
      const x1 = ax + (bx - ax) * (s / steps), y1 = ay + (by - ay) * (s / steps);
      const x2 = ax + (bx - ax) * ((s + 1) / steps), y2 = ay + (by - ay) * ((s + 1) / steps);
      const zone = ribbon[zoneOf((x1 + x2) / 2, (y1 + y2) / 2)];
      if (!zone) continue;                      // 校外的路段不畫
      pushQuad(zone.edge, x1, y1, x2, y2, w + 2.2);
      pushQuad(zone.fill, x1, y1, x2, y2, w);
    }
  }
  path.p.forEach(([x, y]) => {
    const zone = ribbon[zoneOf(x, y)];
    if (!zone) return;
    pushDisc(zone.edge, x, y, (w + 2.2) / 2);
    pushDisc(zone.fill, x, y, w / 2);
  });
});
Object.entries(ribbon).forEach(([key, r]) => {
  [['edge', 0.42], ['fill', 0.48]].forEach(([part, h]) => {
    if (!r[part].length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(r[part], 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: PATH_STYLE[key][part], side: THREE.DoubleSide }));
    mesh.position.y = h;
    scene.add(mesh);
  });
});

// 建築（系館）
const edgeMat = new THREE.LineBasicMaterial({ color: '#8a6a45', transparent: true, opacity: 0.55 });
const buildingMeshes = [];   // 點地圖時，先看有沒有點到建築
BUILDINGS.forEach((b) => {
  const levels = b.h || 3;
  const height = Math.min(48, levels * 3.4);
  const geo = new THREE.ExtrudeGeometry(shapeOf(b.p), { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#f1e2c6' }));
  mesh.position.y = 0.4;
  mesh.userData.building = b;
  buildingMeshes.push(mesh);
  scene.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
  edges.position.y = 0.4;
  scene.add(edges);
  b.height = height;
});

// 中途
const homeMarker = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 6, 24), new THREE.MeshLambertMaterial({ color: '#ffb547' }));
homeMarker.position.set(HOME.x, 3, HOME.y);
scene.add(homeMarker);

// 你的位置（藍點＋誤差範圍＋光柱）
const me = new THREE.Group();
const meDot = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 16), new THREE.MeshLambertMaterial({ color: '#2f7de1', emissive: '#0b3a7a' }));
meDot.position.y = 4;
const meAcc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: '#2f7de1', transparent: true, opacity: 0.18, depthWrite: false }));
meAcc.rotation.x = -Math.PI / 2;
meAcc.position.y = 0.8;
const mePillar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 40, 12), new THREE.MeshBasicMaterial({ color: '#2f7de1', transparent: true, opacity: 0.45 }));
mePillar.position.y = 20;
me.add(meDot, meAcc, mePillar);
me.visible = false;
scene.add(me);

// 練習模式點的位置（圖釘）
const pin = new THREE.Group();
const pinHead = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 14), new THREE.MeshLambertMaterial({ color: '#333' }));
pinHead.position.y = 14;
const pinNeedle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.1, 13, 8), new THREE.MeshLambertMaterial({ color: '#666' }));
pinNeedle.position.y = 6.5;
pin.add(pinHead, pinNeedle);
pin.visible = false;
scene.add(pin);

// =====================================================
//  文字標籤（建築、馬路、中途、你）
// =====================================================
const labelBox = $('labels');
const labels = [];
// rank：數字越小越重要；字擠在一起時，先藏 rank 大的（rank 0 永遠顯示）
function addLabel(text, x, height, y, cls = '', rank = 0) {
  const el = document.createElement('div');
  el.className = 'lbl ' + cls;
  el.textContent = text;
  labelBox.appendChild(el);
  const item = { el, pos: new THREE.Vector3(x, height, y), rank, w: 0, h: 0 };
  labels.push(item);
  return item;
}

// 成功校區裡的建築全部標名字（同一棟分成好幾塊的，只標在最大塊上）
const biggest = {};
BUILDINGS.forEach((b) => { if (!biggest[b.i] || biggest[b.i].area < b.area) biggest[b.i] = b; });
Object.values(biggest).forEach((b) => {
  addLabel(b.name, b.cx, b.height + 3, b.cy, '', MAIN.has(b.name) ? 1 : 2);
});

[['小東路', 0, 1], ['長榮路', 1, 2], ['大學路', 2, 3], ['勝利路', 3, 0]].forEach(([n, i, j]) => {
  const a = CAMPUS[i], b = CAMPUS[j];
  addLabel(n, (a[0] + b[0]) / 2, 2, (a[1] + b[1]) / 2, 'road');
});
addLabel('🏠 中途', HOME.x, 9, HOME.y, 'home');
const meLabel = addLabel('你在這裡', 0, 46, 0, 'me');
meLabel.el.style.display = 'none';
const pinLabel = addLabel('📌 這裡', 0, 20, 0, 'pin');
pinLabel.el.style.display = 'none';

const tmp = new THREE.Vector3();
const byRank = () => labels.slice().sort((a, b) => a.rank - b.rank);
let ordered = null;
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!ordered || ordered.length !== labels.length) ordered = byRank();
  const placed = [];                          // 已經放好的字的範圍，避免疊在一起
  ordered.forEach((L) => {
    if (L.el.style.display === 'none') return;
    tmp.copy(L.pos).project(camera);
    let hidden = tmp.z > 1 || tmp.x < -1.2 || tmp.x > 1.2 || tmp.y < -1.2 || tmp.y > 1.2;
    const sx = (tmp.x + 1) / 2 * w, sy = (1 - tmp.y) / 2 * h;
    if (!hidden && L.rank > 0) {
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      const r = { x1: sx - L.w / 2, x2: sx + L.w / 2, y1: sy - L.h, y2: sy };
      hidden = placed.some((p) => r.x1 < p.x2 && r.x2 > p.x1 && r.y1 < p.y2 && r.y2 > p.y1);
      if (!hidden) placed.push(r);
    } else if (!hidden) {
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      placed.push({ x1: sx - L.w / 2, x2: sx + L.w / 2, y1: sy - L.h, y2: sy });
    }
    L.el.style.visibility = hidden ? 'hidden' : 'visible';
    if (!hidden) L.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
  });
}

// =====================================================
//  上方的狀態卡片
// =====================================================
function showStatus(level, main, sub) {
  const box = $('status');
  if (box.className !== 'status ' + level) {
    box.className = 'status';                 // 重新觸發「搖一搖」動畫
    void box.offsetWidth;
    box.className = 'status ' + level;
  }
  $('status-main').textContent = main;
  $('status-sub').textContent = sub;
}

// =====================================================
//  練習模式：點地圖上的一點
// =====================================================
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let downAt = null;
let tapTimer = null;
let gpsStatus = null;   // 最近一次 GPS 的結果

renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 500;
  downAt = null;
  if (moved > 8 || !quick) return;            // 是拖曳、不是點擊
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  const onBuilding = raycaster.intersectObjects(buildingMeshes, false)[0];
  if (onBuilding) {
    // 點到建築：圖釘放在建築中間，告訴你是哪一棟
    const b = onBuilding.object.userData.building;
    hit.set(b.cx, 0, b.cy);
  } else if (!raycaster.ray.intersectPlane(groundPlane, hit)) {
    return;
  }
  const r = onBuilding ? buildingResult(onBuilding.object.userData.building) : classify(hit.x, hit.z);
  pin.position.set(hit.x, 0, hit.z);
  pin.visible = true;
  pinLabel.pos.set(hit.x, 20, hit.z);
  pinLabel.el.style.display = '';
  showStatus(r.level, '📌 ' + r.main.replace(/^\S+\s/, ''), r.sub.replace('（如果你在外面，可能是 GPS 誤差）', ''));
  // 有在定位的話，過幾秒換回顯示你自己的位置
  clearTimeout(tapTimer);
  if (watchId !== null) {
    tapTimer = setTimeout(() => {
      pin.visible = false;
      pinLabel.el.style.display = 'none';
      if (gpsStatus) showStatus(...gpsStatus);
    }, 5000);
  }
});

// =====================================================
//  GPS 定位
// =====================================================
let watchId = null;
let follow = false;
let firstFix = true;
let lastLevel = null;
let wakeLock = null;

function setFollow(on) {
  follow = on;
  $('btn-follow').classList.toggle('on', on);
}

function startGps() {
  if (!('geolocation' in navigator)) {
    showStatus('bad', '這支手機或瀏覽器不支援定位', '可以先用練習模式：點地圖看看哪裡能走。');
    return;
  }
  showStatus('idle', '📡 定位中…', '第一次使用會詢問能不能使用你的位置，請按「允許」。');
  firstFix = true;
  watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  $('btn-gps').textContent = '⏹ 停止定位';
  $('btn-gps').classList.remove('primary');
  $('btn-follow').disabled = false;
  keepScreenOn();
}

function stopGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  gpsStatus = null;
  lastLevel = null;
  me.visible = false;
  meLabel.el.style.display = 'none';
  setFollow(false);
  $('btn-follow').disabled = true;
  $('btn-gps').textContent = '📍 開始定位';
  $('btn-gps').classList.add('primary');
  showStatus('idle', '👆 點地圖上任何一點，看看那裡能不能走', '或按下方「📍 開始定位」，用 GPS 確認你的位置');
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function onPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const p = fromLatLon(latitude, longitude);
  me.position.set(p.x, 0, p.y);
  meAcc.scale.setScalar(Math.max(3, Math.min(accuracy, 80)));
  me.visible = true;
  meLabel.pos.set(p.x, 46, p.y);
  meLabel.el.style.display = '';

  const far = Math.hypot(p.x - AREA_CENTER.x, p.y - AREA_CENTER.z);
  if (far > 1000) {
    gpsStatus = ['idle', '📍 你目前不在成功校區附近', `距離大約 ${(far / 1000).toFixed(1)} 公里。可以先點地圖練習看看哪裡能走。`];
    if (!pin.visible) showStatus(...gpsStatus);
    firstFix = false;
    return;
  }

  const r = classify(p.x, p.y);
  const note = accuracy > 25 ? `（目前 GPS 誤差約 ${Math.round(accuracy)} 公尺，結果僅供參考）` : '';
  gpsStatus = [r.level, r.main, r.sub + note];
  if (!pin.visible) showStatus(...gpsStatus);

  // 走出範圍時震動提醒
  if (r.level === 'bad' && lastLevel !== 'bad' && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  lastLevel = r.level;

  if (firstFix) {               // 第一次定位成功：鏡頭飛過去並開始跟著你
    firstFix = false;
    setFollow(true);
  }
}

function onGpsError(err) {
  if (err.code === 1) {
    stopGps();
    showStatus('bad', '🔒 沒有取得定位權限', '請到瀏覽器或手機設定，允許這個網站使用位置，再按一次「📍 開始定位」。');
  } else if (err.code === 3) {
    showStatus('warn', '⌛ 定位比較慢…', '請到空曠一點的地方，或稍等一下。');
  } else {
    showStatus('warn', '📡 暫時找不到 GPS 訊號', '請到空曠一點的地方再試試看。');
  }
}

// 定位時讓螢幕不要自動關掉（手機有支援才有用）
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* 不支援就算了 */ }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && watchId !== null && !wakeLock) keepScreenOn();
});

// =====================================================
//  按鈕
// =====================================================
$('btn-gps').addEventListener('click', () => (watchId === null ? startGps() : stopGps()));
$('btn-follow').addEventListener('click', () => setFollow(!follow));

let topView = false;
let camGoal = null;   // 鏡頭要移過去的位置
$('btn-view').addEventListener('click', () => {
  topView = !topView;
  $('btn-view').textContent = topView ? '🧊 3D' : '🗺️ 俯視';
  camGoal = controls.target.clone().add(topView ? VIEW_TOP : VIEW_3D);
});
$('compass').addEventListener('click', () => {      // 點指北針：轉回北方朝上
  const offset = camera.position.clone().sub(controls.target);
  const flat = Math.hypot(offset.x, offset.z);
  camGoal = controls.target.clone().add(new THREE.Vector3(0, offset.y, flat || 1));
});
controls.addEventListener('start', () => { camGoal = null; });

$('legend').addEventListener('click', () => $('legend').classList.toggle('closed'));   // 點圖例可以收起來
if (window.innerWidth < 600) $('legend').classList.add('closed');                     // 手機上一開始先收起來

function openHelp() { $('help').classList.remove('hidden'); }
$('btn-help').addEventListener('click', openHelp);
$('btn-close-help').addEventListener('click', () => {
  $('help').classList.add('hidden');
  try { localStorage.setItem('walk-map-help-seen', '1'); } catch (e) { /* 不能存就算了 */ }
});
let seen = null;
try { seen = localStorage.getItem('walk-map-help-seen'); } catch (e) { /* 不能讀就當沒看過 */ }
if (!seen) openHelp();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================
//  每一格畫面
// =====================================================
const compassEl = $('compass');
function animate() {
  requestAnimationFrame(animate);

  if (follow && me.visible) {                 // 鏡頭跟著你
    const delta = me.position.clone().setY(0).sub(controls.target).multiplyScalar(0.12);
    controls.target.add(delta);
    camera.position.add(delta);
  }
  if (camGoal) {                              // 鏡頭慢慢移到目標
    camera.position.lerp(camGoal, 0.12);
    if (camera.position.distanceTo(camGoal) < 1) camGoal = null;
  }
  controls.update();

  compassEl.style.transform = `rotate(${controls.getAzimuthalAngle()}rad)`;
  mePillar.material.opacity = 0.3 + 0.2 * Math.sin(performance.now() / 300);

  renderer.render(scene, camera);
  updateLabels();
}
animate();
$('loading').classList.add('hidden');
