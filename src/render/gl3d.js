// gl3d.js — RAW WebGL2 "basically 3D" renderer for AEON.
//
// A tilted Civ-6/WorldBox style view of the REAL sim: the world heightmap becomes
// a lit 3D terrain mesh (per-vertex normals, biome+height vertex colors, a moving
// directional SUN + ambient + distance fog), a translucent shimmering WATER plane
// sits at sea level, and every agent + settlement is a GPU-INSTANCED camera-facing
// billboard quad positioned at (x, terrainHeight, y) with a projected ground blob.
//
// HARD CONSTRAINTS honored:
//  - Plain ES module, browser, NO build step, ZERO deps, NO three.js, NO CDN.
//  - Own shaders / own matrix math / own instancing. Local-only.
//  - Performance: terrain mesh is baked ONCE (static VBO). Agents are drawn in a
//    SINGLE instanced draw call (one quad, N instances) with a per-frame buffer
//    upload that is frustum-distance culled on the CPU, so 2000-5000 agents cost
//    almost nothing. Water is one quad. No per-agent JS objects in the hot path.
//  - Reads ONLY existing sim/world accessors; never mutates the sim. Creates no
//    global state; safe to construct once and drive from a RAF loop.
//
// Public API:
//   const r = new GL3D(canvas, sim);   // builds GL state + bakes terrain mesh
//   r.resize(cssW, cssH, dpr);         // call on layout / DPR change
//   r.render(camera3d);                // draw one frame for the given orbit camera
//   r.dispose();                       // free GL resources
//   GL3D.isSupported()                 // static WebGL2 probe
//
// The orbit camera is a tiny plain object (see Camera3D below) so the demo page
// owns input; this file owns pixels.

import { BIOME } from '../sim/world.js';

// ----------------------------------------------------------------- mat4 helpers
// Column-major 4x4 (WebGL convention). Hand-rolled; no library.
const M = {
  ident(o) { o.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); return o; },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0]=f/aspect; o[1]=0; o[2]=0;  o[3]=0;
    o[4]=0;        o[5]=f; o[6]=0;  o[7]=0;
    o[8]=0;        o[9]=0; o[10]=(far+near)*nf; o[11]=-1;
    o[12]=0;       o[13]=0; o[14]=2*far*near*nf; o[15]=0;
    return o;
  },

  // look-at: eye, center, up -> view matrix
  lookAt(o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    let zx=ex-cx, zy=ey-cy, zz=ez-cz;
    let zl=Math.hypot(zx,zy,zz)||1; zx/=zl; zy/=zl; zz/=zl;
    // x = up × z
    let xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx;
    let xl=Math.hypot(xx,xy,xz)||1; xx/=xl; xy/=xl; xz/=xl;
    // y = z × x
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    o[0]=xx; o[1]=yx; o[2]=zx; o[3]=0;
    o[4]=xy; o[5]=yy; o[6]=zy; o[7]=0;
    o[8]=xz; o[9]=yz; o[10]=zz; o[11]=0;
    o[12]=-(xx*ex+xy*ey+xz*ez);
    o[13]=-(yx*ex+yy*ey+yz*ez);
    o[14]=-(zx*ex+zy*ey+zz*ez);
    o[15]=1;
    return o;
  },

  mul(o, a, b) { // o = a * b
    for (let c = 0; c < 4; c++) {
      const bi = c * 4, b0=b[bi], b1=b[bi+1], b2=b[bi+2], b3=b[bi+3];
      o[bi]   = a[0]*b0 + a[4]*b1 + a[8]*b2  + a[12]*b3;
      o[bi+1] = a[1]*b0 + a[5]*b1 + a[9]*b2  + a[13]*b3;
      o[bi+2] = a[2]*b0 + a[6]*b1 + a[10]*b2 + a[14]*b3;
      o[bi+3] = a[3]*b0 + a[7]*b1 + a[11]*b2 + a[15]*b3;
    }
    return o;
  },

  // 4x4 inverse (returns o, or null if singular). Standard cofactor expansion.
  invert(o, m) {
    const a00=m[0],a01=m[1],a02=m[2],a03=m[3], a10=m[4],a11=m[5],a12=m[6],a13=m[7],
          a20=m[8],a21=m[9],a22=m[10],a23=m[11], a30=m[12],a31=m[13],a32=m[14],a33=m[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
          b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
          b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
          b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (!det) return null;
    det = 1.0 / det;
    o[0]=(a11*b11-a12*b10+a13*b09)*det; o[1]=(a02*b10-a01*b11-a03*b09)*det;
    o[2]=(a31*b05-a32*b04+a33*b03)*det; o[3]=(a22*b04-a21*b05-a23*b03)*det;
    o[4]=(a12*b08-a10*b11-a13*b07)*det; o[5]=(a00*b11-a02*b08+a03*b07)*det;
    o[6]=(a32*b02-a30*b05-a33*b01)*det; o[7]=(a20*b05-a22*b02+a23*b01)*det;
    o[8]=(a10*b10-a11*b08+a13*b06)*det; o[9]=(a01*b08-a00*b10-a03*b06)*det;
    o[10]=(a30*b04-a31*b02+a33*b00)*det; o[11]=(a21*b02-a20*b04-a23*b00)*det;
    o[12]=(a11*b07-a10*b09-a12*b06)*det; o[13]=(a00*b09-a01*b07+a02*b06)*det;
    o[14]=(a31*b01-a30*b03-a32*b00)*det; o[15]=(a20*b03-a21*b01+a22*b00)*det;
    return o;
  },
};

// unproject an NDC point (x,y in -1..1, z in -1 near .. 1 far) through an inverse
// view-proj matrix to a world-space point. Returns [x,y,z] or null on w≈0.
function unproject(inv, x, y, z) {
  const X = inv[0]*x + inv[4]*y + inv[8]*z + inv[12];
  const Y = inv[1]*x + inv[5]*y + inv[9]*z + inv[13];
  const Z = inv[2]*x + inv[6]*y + inv[10]*z + inv[14];
  const Wc = inv[3]*x + inv[7]*y + inv[11]*z + inv[15];
  if (Math.abs(Wc) < 1e-9) return null;
  return [X/Wc, Y/Wc, Z/Wc];
}

// ----------------------------------------------------------------- world scale
// The world is W×H tiles. We render it centered on the origin in XZ, with Y up.
// One tile = one world unit. Height is elevation(0..1) * HEIGHT_SCALE.
const HEIGHT_SCALE = 14;   // vertical exaggeration so relief reads as real 3D

// ----------------------------------------------------------------- biome colors
// Mirror the 2D palette (visuals.js PAL) so the 3D look matches the game's world.
const PAL = {
  [BIOME.DEEP]:    [0.08, 0.17, 0.29],
  [BIOME.WATER]:   [0.31, 0.55, 0.67],
  [BIOME.SAND]:    [0.88, 0.81, 0.60],
  [BIOME.GRASS]:   [0.48, 0.66, 0.34],
  [BIOME.FOREST]:  [0.26, 0.46, 0.27],
  [BIOME.HILL]:    [0.63, 0.59, 0.41],
  [BIOME.MOUNTAIN]:[0.50, 0.49, 0.51],
  [BIOME.SNOW]:    [0.93, 0.95, 0.97],
};

// ----------------------------------------------------------------- shader source
const TERRAIN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;     // x, elevation*scale, z (world units)
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in vec4 aOwner;   // nation tint rgb + a (a = ownership strength)
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
out vec4 vOwner;
out float vDist;   // camera-space depth for fog
out float vHeight; // world Y for subtle height tint
out vec2 vXZ;      // world XZ for cloud shadows
void main(){
  vNormal = aNormal;
  vColor = aColor;
  vOwner = aOwner;
  vHeight = aPos.y;
  vXZ = aPos.xz;
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec4 vOwner;
in float vDist;
in float vHeight;
in vec2 vXZ;
uniform vec3 uSunDir;     // normalized, toward the sun
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOverlay;   // global nation-overlay strength (0..1)
uniform float uTime;      // tick clock for animated cloud shadows
uniform vec2 uCloud;      // cloud-field scroll offset (world units)
out vec4 frag;

// cheap value-noise for soft drifting cloud shadows (2 octaves)
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

void main(){
  vec3 N = normalize(vNormal);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 base = vColor;
  // NATION OVERLAY: tint owned land toward the nation color; the alpha channel
  // also encodes a border band (boosted at the territory edge) so borders read.
  float own = vOwner.a * uOverlay;
  if (own > 0.001) {
    base = mix(base, vOwner.rgb, clamp(own, 0.0, 0.62));
  }
  // wrap a little ambient bounce on shadowed faces so they don't go black
  vec3 lit = base * (uAmbient + uSunColor * diff);
  // a faint specular sheen on near-flat lit faces (snow/rock glint)
  float spec = pow(max(diff, 0.0), 16.0) * 0.10;
  lit += spec;

  // DRIFTING CLOUD SHADOWS: a soft scrolling noise field darkens the land where a
  // cloud passes over — ambient life, costs two noise lookups, no extra geometry.
  vec2 cp = (vXZ + uCloud) * 0.018;
  float cl = vnoise(cp) * 0.62 + vnoise(cp * 2.3 + 7.0) * 0.38;
  float shadow = smoothstep(0.52, 0.78, cl);     // only the denser cloud cores cast
  lit *= 1.0 - shadow * 0.34;

  // height haze: very high peaks pick up a touch of sky for aerial depth
  lit = mix(lit, uFogColor, clamp((vHeight/14.0 - 0.7)*0.5, 0.0, 0.18));
  // distance fog -> atmospheric depth
  float fog = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  fog = fog * fog;
  frag = vec4(mix(lit, uFogColor, fog), 1.0);
}`;

const WATER_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aXZ;   // unit quad corner 0..1
uniform mat4 uViewProj;
uniform vec2 uWorldMin;
uniform vec2 uWorldSize;
uniform float uSeaY;
out vec2 vWorld;
out float vDist;
void main(){
  vec2 world = uWorldMin + aXZ * uWorldSize;
  vWorld = world;
  vec4 clip = uViewProj * vec4(world.x, uSeaY, world.y, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec2 vWorld;
in float vDist;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
out vec4 frag;
void main(){
  // animated ripple normal from crossed sine waves (cheap moving shimmer)
  float w1 = sin(vWorld.x*0.45 + uTime*1.3) + sin(vWorld.y*0.39 - uTime*1.1);
  float w2 = sin((vWorld.x+vWorld.y)*0.30 + uTime*0.7);
  vec3 N = normalize(vec3(w1*0.06, 1.0, w2*0.06));
  float diff = max(dot(N, uSunDir), 0.0);
  // sun glint on the wave crests
  float glint = pow(max(diff, 0.0), 40.0);
  vec3 deep = vec3(0.06, 0.16, 0.30);
  vec3 shallow = vec3(0.18, 0.40, 0.55);
  vec3 col = mix(deep, shallow, clamp(diff*0.8 + 0.25, 0.0, 1.0));
  col += glint * vec3(0.7, 0.85, 0.95);
  float fog = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fog*fog);
  frag = vec4(col, 0.72);   // translucent
}`;

// Instanced ANIMATED billboards: one unit quad, per-instance (worldPos, size, rgb,
// kind) PLUS an animation vector iAnim = (phase, speed, packedState). The whole
// living crowd — walk cycles, idle breathe, combat lunges, carried loads, death
// fades — animates ENTIRELY in-shader from a single uTime uniform + per-instance
// phase, so 2000+ agents move out of phase in ONE instanced draw call. Zero
// per-frame CPU object churn: renderer3d only writes flat floats into the buffer.
//
// iAnim.x = phase   : per-agent 0..1 seed → desync the gait/breath across the crowd
// iAnim.y = speed   : 0 idle .. 1 running → blends idle-breathe → walk amplitude
// iAnim.z = state   : packed flags+facing+fade, decoded below:
//                     facing  = fract(state)         (0..1 → heading angle/τ)
//                     carry   = mod(floor(state),2.)  (1 = hauling a load)
//                     combat  = mod(floor(state/2.),4.)/3. (0..1 strike pulse)
//                     fade    = mod(floor(state/8.),16.)/15. (1 alive .. 0 dead/gone)
const SPRITE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;       // -0.5..0.5 quad
layout(location=1) in vec3 iPos;          // world position (x, y, z)
layout(location=2) in vec4 iData;         // size, r, g, b  (packed)
layout(location=3) in vec2 iMeta;         // kind(0 agent,1 settle,2 shadow), bright
layout(location=4) in vec3 iAnim;         // phase, speed, packedState
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTime;
uniform float uPxScale;
out vec3 vColor;
out vec2 vUV;
out float vKind;
out float vDist;
out float vPhase;     // gait clock for this agent (radians)
out float vSpeed;     // 0 idle .. 1 run
out float vFacing;    // -1 face-left .. +1 face-right relative to camera
out float vCarry;     // 1 = hauling a load
out float vCombat;    // 0..1 attack-strike pulse
out float vFade;      // 1 alive .. 0 dead

void main(){
  float size = iData.x;
  vUV = aCorner;
  vKind = iMeta.x;

  // ---- decode the packed animation state ----
  float st = iAnim.z;
  float facingA = fract(st) * 6.2831853;          // heading angle (world XZ)
  float fl = floor(st);
  vCarry  = mod(fl, 2.0);
  vCombat = mod(floor(st / 2.0), 4.0) / 3.0;
  vFade   = mod(floor(st / 8.0), 16.0) / 15.0;
  vSpeed  = iAnim.y;

  // gait clock: a global beat + per-agent phase, sped up when running. Two legs
  // means a full stride is 2π; we advance faster the quicker the agent moves.
  float gait = uTime * (3.4 + vSpeed * 7.0) + iAnim.x * 6.2831853;
  vPhase = gait;

  // FACING: project the agent's world heading onto the camera-right axis so the
  // fragment shader can flip/skew the silhouette to "lean" into travel without a
  // separate draw. (camRight is unit; dot gives -1..1.)
  vec3 headDir = vec3(cos(facingA), 0.0, sin(facingA));
  vFacing = dot(headDir, uCamRight);

  vec3 worldPos;
  if (iMeta.x > 1.5) {
    // SHADOW: a flat ground quad on the XZ plane (not camera-facing). It squashes
    // a touch under the body on each footfall so the contact reads (cheap life).
    float bob = (vSpeed > 0.02) ? (0.04 * vSpeed * (0.5 + 0.5*sin(gait*2.0))) : 0.0;
    float sq = 1.0 + bob;                 // shadow grows slightly as body lifts
    worldPos = iPos + vec3(aCorner.x, 0.0, aCorner.y) * size * sq;
    vColor = iData.yzw;                   // (unused by shadow frag)
  } else {
    // BILLBOARD figure: face the camera, anchored at the base.
    // VERTICAL BODY BOB: a gentle up/down on each stride (2 steps per cycle) when
    // walking; a slow breathe when idle. Eased, never popping.
    float bob = (vSpeed > 0.02)
      ? (0.5 + 0.5 * sin(gait * 2.0)) * 0.06 * vSpeed * size      // footfall bob
      : sin(uTime * 1.6 + iAnim.x * 6.2831853) * 0.012 * size;     // idle breathe
    // COMBAT LUNGE: punch the whole body forward (toward facing) on a strike.
    float lunge = vCombat * 0.18 * size;
    // DEATH SINK: a dying figure sags toward the ground as it fades.
    float sink = (1.0 - vFade) * 0.35 * size;

    vec3 right = uCamRight * (aCorner.x * size);
    vec3 up = uCamUp * ((aCorner.y + 0.5) * size + bob - sink);
    worldPos = iPos + right + up + uCamRight * (vFacing * lunge);
    vColor = iData.yzw * iMeta.y;
  }
  vec4 clip = uViewProj * vec4(worldPos, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vUV;     // -0.5..0.5 quad space
in float vKind;  // 0 agent · 1 settlement marker · 2 shadow · 3 soldier · 4 boat
in float vDist;
in float vPhase;   // gait clock (radians)
in float vSpeed;   // 0 idle .. 1 run
in float vFacing;  // -1..+1 lean direction (relative to camera)
in float vCarry;   // 1 hauling a load
in float vCombat;  // 0..1 strike pulse
in float vFade;    // 1 alive .. 0 dead
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
out vec4 frag;

// signed-distance helpers for the little articulated figure
float sdCircle(vec2 p, vec2 c, float r){ return length(p - c) - r; }
float sdBox(vec2 p, vec2 c, vec2 b){ vec2 d = abs(p - c) - b; return length(max(d,0.0)) + min(max(d.x,d.y),0.0); }
// a capsule/segment (limb): distance to segment a..b, thickness r
float sdSeg(vec2 p, vec2 a, vec2 b, float r){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
  return length(pa - ba*h) - r;
}

void main(){
  float fog = clamp((vDist - uFogNear)/(uFogFar - uFogNear), 0.0, 1.0); fog *= fog;
  float r = length(vUV);

  // ----- SHADOW (flat ground disc) -----
  if (vKind > 1.5 && vKind < 2.5) {
    float a = smoothstep(0.5, 0.16, r) * 0.34;
    if (a < 0.01) discard;
    frag = vec4(0.0, 0.0, 0.0, a);
    return;
  }

  // ----- SETTLEMENT marker (only used at far zoom as a banner dot) -----
  if (vKind > 0.5 && vKind < 1.5) {
    if (r > 0.5) discard;
    float top = smoothstep(-0.1, 0.5, vUV.y);
    vec3 c = mix(vColor*0.7, vColor*1.3, top);
    frag = vec4(mix(c, uFogColor, fog), 1.0);
    return;
  }

  // ----- FIGURE: an ARTICULATED human — head + torso + swinging arms + stepping
  //       legs — all in SDFs, animated from the gait clock. quad y: -0.5 feet .. +0.5 head.
  vec2 p = vUV;
  // lean into travel: skew the upper body slightly toward the direction of motion
  float lean = vFacing * (0.06 + vSpeed * 0.10);
  p.x -= lean * smoothstep(-0.4, 0.5, p.y);

  // gait drive: legs scissor in antiphase; arms swing opposite the legs. When idle,
  // 'sw' fades to ~0 so the limbs settle (no jitter), with a faint breathing sway.
  float run = smoothstep(0.0, 0.25, vSpeed);
  float swing = sin(vPhase) * (0.12 + 0.16 * vSpeed) * run;   // leg stride amplitude
  float idleSway = sin(vPhase * 0.5) * 0.010 * (1.0 - run);   // tiny idle weight-shift
  swing += idleSway;
  float lift = max(0.0, sin(vPhase)) * 0.05 * run;            // forward knee lift

  // head
  float head = sdCircle(p, vec2(0.0, 0.34), 0.125);
  // torso (tapered)
  float bodyW = mix(0.17, 0.115, smoothstep(-0.18, 0.20, p.y));
  float torso = sdBox(p, vec2(0.0, 0.06), vec2(bodyW, 0.18));
  // LEGS: two segments from the hip (0,-0.10) splaying to the feet; one forward,
  // one back, swapping with the stride → a readable walk cycle.
  vec2 hip = vec2(0.0, -0.10);
  float legT = 0.055;
  vec2 footA = vec2( swing,        -0.50 + lift);
  vec2 footB = vec2(-swing,        -0.50);
  float legA = sdSeg(p, hip, footA, legT);
  float legB = sdSeg(p, hip, footB, legT);
  float legs = min(legA, legB);
  // ARMS: shoulders at (±0.13, 0.18), hands swing OPPOSITE the legs. While carrying,
  // both arms come forward to hold a load; while striking, the lead arm thrusts out.
  vec2 shL = vec2(-0.135, 0.18), shR = vec2(0.135, 0.18);
  float armSwing = -swing;
  vec2 handL = shL + vec2(-0.02 + armSwing*0.6, -0.26);
  vec2 handR = shR + vec2( 0.02 - armSwing*0.6, -0.26);
  // carry pose: hands meet in front, lifted (holding a parcel)
  handL = mix(handL, vec2(-0.05, 0.02), vCarry);
  handR = mix(handR, vec2( 0.05, 0.02), vCarry);
  // strike pose: lead arm (in facing dir) punches outward + up on the pulse
  float dir = (vFacing >= 0.0) ? 1.0 : -1.0;
  vec2 strikeHand = vec2(dir * (0.30 + 0.12*vCombat), 0.22);
  handR = mix(handR, strikeHand, vCombat * step(0.0, dir));
  handL = mix(handL, strikeHand, vCombat * step(dir, -0.0001));
  float armR = sdSeg(p, shR, handR, 0.05);
  float armL = sdSeg(p, shL, handL, 0.05);
  float arms = min(armL, armR);

  float fig = min(min(head, torso), min(legs, arms));

  // CARRIED LOAD: a little crate held at the chest when hauling resources.
  float load = 1e9;
  if (vCarry > 0.5) {
    load = sdBox(p, vec2(0.0, 0.05), vec2(0.10, 0.085));
    fig = min(fig, load);
  }
  // BOAT (vKind 4): a hull crescent under the crew so it reads as a vessel.
  float hull = 1e9;
  if (vKind > 3.5) {
    hull = sdBox(p, vec2(0.0, -0.40), vec2(0.36, 0.10));
    fig = min(fig, hull);
  }

  // anti-aliased silhouette edge (smooth, no popping at distance)
  float aa = fwidth(fig) + 1e-4;
  float cover = 1.0 - smoothstep(0.0, aa, fig);
  // death fade: the figure dissolves + drops alpha as vFade → 0
  cover *= smoothstep(0.0, 0.12, vFade);
  if (cover < 0.01) discard;

  // shading: upper body catches light, feet fall into shadow (cheap form light)
  float lit = 0.62 + 0.55 * smoothstep(-0.50, 0.45, p.y);
  float headMask = 1.0 - smoothstep(0.0, 0.02, head);
  vec3 c = vColor * lit;
  c += headMask * vColor * 0.18;
  // carried crate reads as a warm wooden parcel, not tribe-tinted
  float loadMask = (vCarry > 0.5) ? (1.0 - smoothstep(0.0, 0.02, load)) : 0.0;
  c = mix(c, vec3(0.60, 0.44, 0.26) * lit, loadMask);
  // SOLDIER (vKind 3): steel-darkened + a shoulder glint that FLASHES on a strike
  if (vKind > 2.5 && vKind < 3.5) {
    c *= 0.92;
    float glint = (1.0 - smoothstep(0.0, 0.03, sdBox(p, vec2(0.0, 0.16), vec2(0.20, 0.03))));
    c += glint * vec3(0.9, 0.9, 0.95) * (0.22 + vCombat * 0.6);
  }
  // combat heat: a red rim pulse on whoever is mid-strike (civilians too)
  c += vCombat * vec3(0.5, 0.05, 0.0) * (1.0 - smoothstep(0.0, 0.04, fig));
  // dying: desaturate toward grey as it fades
  c = mix(vec3(dot(c, vec3(0.33)))*0.7, c, vFade);

  vec3 outC = mix(c, uFogColor, fog);
  frag = vec4(outC, cover);
}`;

// Instanced procedural BUILDINGS — a real extruded box per structure (one draw
// call for the whole skyline). Per-instance: base world pos, footprint, height,
// rgb tint, roof flag. A unit cube (0..1 in Y, -0.5..0.5 in XZ) is scaled + placed.
const BUILD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;     // unit box: x,z in -0.5..0.5, y in 0..1
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iBase;    // world base (x, groundY, z)
layout(location=3) in vec4 iSize;    // footX, height, footZ, roofKind
layout(location=4) in vec3 iColor;   // tribe-tinted wall color
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
out float vDist;
out float vUp;       // 0 base .. 1 roof (for roof shading)
out float vRoof;
out vec3 vWorld;     // world pos (for night-window placement)
void main(){
  vNormal = aNormal;
  vColor = iColor;
  vUp = aPos.y;
  vRoof = iSize.w;
  vec3 world = iBase + vec3(aPos.x * iSize.x, aPos.y * iSize.y, aPos.z * iSize.z);
  vWorld = world;
  vec4 clip = uViewProj * vec4(world, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

const BUILD_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in float vDist;
in float vUp;
in float vRoof;
in vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uNight;   // 0 day .. 1 night → lit windows
out vec4 frag;
void main(){
  vec3 N = normalize(vNormal);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 wall = vColor;
  // roof: top faces (normal mostly +Y) get a distinct roof tint by kind
  bool topFace = N.y > 0.6;
  if (topFace) {
    if (vRoof > 1.5)      wall = mix(vColor, vec3(0.85,0.82,0.78), 0.5); // pale (temple/keep)
    else if (vRoof > 0.5) wall = vColor * vec3(0.78, 0.42, 0.34);         // terracotta roof
    else                  wall = vColor * 0.82;                            // flat hut roof
  } else {
    // a faint vertical gradient on walls so towers read tall (darker at base)
    wall *= 0.78 + 0.22 * vUp;
  }
  vec3 lit = wall * (uAmbient + uSunColor * diff);
  // NIGHT WINDOWS: warm glints flicker on the lower walls after dusk — settlements
  // read as inhabited at night. A cheap hashed grid lit only on side faces.
  if (uNight > 0.05 && !topFace) {
    vec2 wcoord = floor(vec2(vWorld.x + vWorld.z, vUp * 6.0) * 1.6);
    float win = fract(sin(dot(wcoord, vec2(91.3, 47.7))) * 4137.1);
    float lampMask = step(0.62, win) * step(0.12, vUp) * step(vUp, 0.85);
    lit += lampMask * uNight * vec3(1.0, 0.74, 0.34) * 0.7;
  }
  float fog = clamp((vDist - uFogNear)/(uFogFar - uFogNear), 0.0, 1.0);
  frag = vec4(mix(lit, uFogColor, fog*fog), 1.0);
}`;

// Instanced TREES — a camera-facing trunk+canopy billboard per forested tile. The
// canopy SWAYS in the vertex shader (top sheared by a per-tree-phased sine of
// uTime) so a whole forest breathes in the wind in ONE instanced draw call. The
// instance buffer is BAKED ONCE from the heightmap (FOREST tiles), never per-frame.
const TREE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // -0.5..0.5 quad
layout(location=1) in vec4 iPos;      // x, groundY, z, sizeScale
layout(location=2) in vec2 iVar;      // phase, hueShift
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTime;
out vec2 vUV;
out float vDist;
out float vHue;
void main(){
  vUV = aCorner;
  vHue = iVar.y;
  float size = iPos.w;
  // WIND SWAY: shear the top of the tree sideways; amount grows toward the canopy.
  float up = aCorner.y + 0.5;                       // 0 base .. 1 top
  float sway = sin(uTime * 1.7 + iVar.x * 6.2831853) * 0.12
             + sin(uTime * 3.1 + iVar.x * 12.0) * 0.04;
  float bend = sway * up * up;                       // quadratic — base stays planted
  vec3 right = uCamRight * (aCorner.x * size + bend * size);
  vec3 upv = uCamUp * (up * size);
  vec3 world = iPos.xyz + right + upv;
  vec4 clip = uViewProj * vec4(world, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

const TREE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vDist;
in float vHue;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
out vec4 frag;
float sdCircle(vec2 p, vec2 c, float r){ return length(p-c)-r; }
float sdBox(vec2 p, vec2 c, vec2 b){ vec2 d=abs(p-c)-b; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }
void main(){
  vec2 p = vUV;
  // trunk: a thin box at the base
  float trunk = sdBox(p, vec2(0.0, -0.30), vec2(0.045, 0.20));
  // canopy: a soft blob (3 overlapping circles) up top
  float c1 = sdCircle(p, vec2(0.0, 0.12), 0.30);
  float c2 = sdCircle(p, vec2(-0.16, 0.0), 0.22);
  float c3 = sdCircle(p, vec2(0.16, 0.02), 0.22);
  float canopy = min(c1, min(c2, c3));
  float tree = min(trunk, canopy);
  float aa = fwidth(tree) + 1e-4;
  float cover = 1.0 - smoothstep(0.0, aa, tree);
  if (cover < 0.01) discard;
  // color: forest green (hue-shifted a touch per tree), trunk brown
  float canMask = 1.0 - smoothstep(0.0, 0.01, canopy);
  vec3 green = mix(vec3(0.16,0.36,0.18), vec3(0.30,0.50,0.24), vHue);
  // simple form light: brighter on the upper-left of the canopy
  float lit = 0.7 + 0.4 * smoothstep(-0.3, 0.5, p.y - p.x*0.3);
  vec3 col = mix(vec3(0.32,0.21,0.12), green*lit, canMask);
  col *= (uAmbient + uSunColor) * 0.6;
  float fog = clamp((vDist-uFogNear)/(uFogFar-uFogNear),0.0,1.0); fog*=fog;
  frag = vec4(mix(col, uFogColor, fog), cover);
}`;

// Instanced CHIMNEY SMOKE — a stack of soft puffs rising from each settlement. Each
// puff RISES + drifts + expands + fades on a loop in the vertex/fragment shaders,
// phased per-puff so the column is continuous. Instances BAKED per settlement.
const SMOKE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // -0.5..0.5 quad
layout(location=1) in vec4 iPos;      // x, baseY, z, seed
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTime;
out vec2 vUV;
out float vDist;
out float vLife;     // 0 fresh .. 1 dissipated
void main(){
  vUV = aCorner;
  float seed = iPos.w;
  // each puff loops on its own clock; staggered by seed so the column is unbroken
  float life = fract(uTime * 0.16 + seed);
  vLife = life;
  float rise = life * 13.0;                         // climbs ~13 world units
  float drift = sin(seed * 20.0 + life * 3.0) * 3.0 * life;   // lazy sideways drift
  float grow = 1.4 + life * 3.6;                    // puffs expand as they rise
  vec3 c = iPos.xyz + vec3(drift, rise, drift * 0.5);
  vec3 world = c + uCamRight * (aCorner.x * grow) + uCamUp * ((aCorner.y + 0.5) * grow);
  vec4 clip = uViewProj * vec4(world, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

const SMOKE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vDist;
in float vLife;
uniform float uNight;
out vec4 frag;
void main(){
  float r = length(vUV);
  float soft = smoothstep(0.5, 0.0, r);             // round soft puff
  // fade in quickly, then out over its life; tasteful but readable at distance
  float a = soft * (1.0 - vLife) * smoothstep(0.0, 0.12, vLife) * 0.55;
  if (a < 0.01) discard;
  // smoke greys, a touch warmer/darker at the source, cooler as it thins
  vec3 col = mix(vec3(0.55,0.52,0.50), vec3(0.80,0.82,0.85), vLife);
  col *= mix(1.0, 0.5, uNight);                      // dimmer at night
  frag = vec4(col, a);
}`;

// ----------------------------------------------------------------- GL utilities
function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + log + '\n' + src.slice(0, 200));
  }
  return sh;
}

function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('program link failed: ' + log);
  }
  return p;
}

// uniform-location cache helper
function uloc(gl, prog, names) {
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return u;
}

// ----------------------------------------------------------------- the renderer
export class GL3D {
  static isSupported() {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch { return false; }
  }

  constructor(canvas, sim) {
    this.canvas = canvas;
    this.sim = sim;
    this.world = sim.world;
    this.lost = false;

    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true,
      premultipliedAlpha: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    // robust against GPU context loss
    this._onLost = (e) => { e.preventDefault(); this.lost = true; };
    this._onRestored = () => {
      this.lost = false; this._initGL();
      this._buildTerrain(); this._buildWater(); this._buildSpriteQuad(); this._buildBoxMesh();
      this._buildTrees(); this._buildSmokeQuad();
      this._ownerDirty = true;
    };
    canvas.addEventListener('webglcontextlost', this._onLost, false);
    canvas.addEventListener('webglcontextrestored', this._onRestored, false);

    // world geometry constants
    const W = this.world;
    this.cx = W.w / 2;
    this.cz = W.h / 2;
    this.seaY = W.seaLevel * HEIGHT_SCALE;

    // scratch matrices (allocated once)
    this._view = new Float32Array(16);
    this._proj = new Float32Array(16);
    this._vp = new Float32Array(16);

    // instance buffer scratch (grows as needed); 8 floats per instance:
    // pos.x pos.y pos.z | size r g b | kind*?  -> we pack as 3 + 4 + 2 = 9 floats
    this._instCap = 0;
    this._inst = null;

    this._initGL();
    this._buildTerrain();
    this._buildWater();
    this._buildSpriteQuad();
    this._buildBoxMesh();
    this._buildTrees();        // baked forest billboards (sway in-shader)
    this._buildSmokeQuad();    // chimney-smoke quad + dynamic instance buffer
    this.overlay = 0.85;       // nation-overlay strength (adapter can tune by zoom)
  }

  // ------------------------------------------------------------- GL program init
  _initGL() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0.50, 0.62, 0.78, 1.0);   // sky

    this.progTerrain = program(gl, TERRAIN_VS, TERRAIN_FS);
    this.uTerrain = uloc(gl, this.progTerrain,
      ['uViewProj','uSunDir','uSunColor','uAmbient','uFogColor','uFogNear','uFogFar','uOverlay','uTime','uCloud']);

    this.progWater = program(gl, WATER_VS, WATER_FS);
    this.uWater = uloc(gl, this.progWater,
      ['uViewProj','uWorldMin','uWorldSize','uSeaY','uTime','uSunDir','uFogColor','uFogNear','uFogFar']);

    this.progSprite = program(gl, SPRITE_VS, SPRITE_FS);
    this.uSprite = uloc(gl, this.progSprite,
      ['uViewProj','uCamRight','uCamUp','uTime','uPxScale','uFogColor','uFogNear','uFogFar']);

    this.progBuild = program(gl, BUILD_VS, BUILD_FS);
    this.uBuild = uloc(gl, this.progBuild,
      ['uViewProj','uSunDir','uSunColor','uAmbient','uFogColor','uFogNear','uFogFar','uNight']);

    this.progTree = program(gl, TREE_VS, TREE_FS);
    this.uTree = uloc(gl, this.progTree,
      ['uViewProj','uCamRight','uCamUp','uTime','uFogColor','uFogNear','uFogFar','uSunColor','uAmbient']);

    this.progSmoke = program(gl, SMOKE_VS, SMOKE_FS);
    this.uSmoke = uloc(gl, this.progSmoke,
      ['uViewProj','uCamRight','uCamUp','uTime','uNight']);
  }

  // ------------------------------------------------------------- terrain mesh
  // Build a vertex grid from the heightmap. Each tile center is a vertex; we emit
  // two triangles per quad. Per-vertex normal from the height gradient; per-vertex
  // color from biome + a little height/slope shading baked in. Static VBO.
  _buildTerrain() {
    const gl = this.gl, W = this.world;
    const w = W.w, h = W.h, elev = W.elev, biome = W.biome;
    const hAt = (x, y) => {
      if (x < 0) x = 0; else if (x >= w) x = w - 1;
      if (y < 0) y = 0; else if (y >= h) y = h - 1;
      return elev[y * w + x] * HEIGHT_SCALE;
    };

    const nVerts = w * h;
    const pos = new Float32Array(nVerts * 3);
    const nrm = new Float32Array(nVerts * 3);
    const col = new Float32Array(nVerts * 3);
    const ox = -this.cx, oz = -this.cz;   // center the world at origin

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const e = elev[i];
        let yy = e * HEIGHT_SCALE;
        // clamp water-bottom up toward sea level so the mesh doesn't sink to abyss
        // (the translucent water plane covers it); keeps a believable seabed shelf.
        if (yy < this.seaY - 2) yy = this.seaY - 2 + (yy - (this.seaY - 2)) * 0.25;
        const px = x + 0.5 + ox, pz = y + 0.5 + oz;
        pos[i*3] = px; pos[i*3+1] = yy; pos[i*3+2] = pz;

        // normal from central-difference of the height field (Sobel-ish)
        const hL = hAt(x-1, y), hR = hAt(x+1, y);
        const hD = hAt(x, y-1), hU = hAt(x, y+1);
        // gradient; tile spacing = 1 unit
        let nx = (hL - hR), ny = 2.0, nz = (hD - hU);
        const nl = Math.hypot(nx, ny, nz) || 1;
        nrm[i*3] = nx/nl; nrm[i*3+1] = ny/nl; nrm[i*3+2] = nz/nl;

        // vertex color from biome palette, with a gentle height value-ramp so big
        // areas aren't flat and snow/rock brighten with altitude.
        const b = biome[i];
        const base = PAL[b] || PAL[BIOME.GRASS];
        let cr = base[0], cg = base[1], cb = base[2];
        // slope darkening: steep faces a touch darker (matches 2D hillshade feel)
        const slope = 1 - Math.min(1, (nrm[i*3+1]));      // 0 flat .. ~1 cliff
        const sh = 1 - slope * 0.35;
        // altitude lighten on rock/snow
        if (b === BIOME.MOUNTAIN || b === BIOME.SNOW || b === BIOME.HILL) {
          const t = Math.min(1, Math.max(0, (e - 0.7) / 0.3));
          cr = cr + (0.95 - cr) * t * 0.4;
          cg = cg + (0.97 - cg) * t * 0.4;
          cb = cb + (0.99 - cb) * t * 0.4;
        }
        col[i*3] = cr * sh; col[i*3+1] = cg * sh; col[i*3+2] = cb * sh;
      }
    }

    // index buffer: two triangles per cell (CCW when viewed from +Y)
    const nCells = (w - 1) * (h - 1);
    const idx = new Uint32Array(nCells * 6);
    let o = 0;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = y * w + x;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        // CCW from above (+Y up, +Z "south"): a, c, b and b, c, d
        idx[o++] = a; idx[o++] = c; idx[o++] = b;
        idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
    }
    this._terrainCount = idx.length;

    // upload to a VAO
    if (this.vaoTerrain) gl.deleteVertexArray(this.vaoTerrain);
    this.vaoTerrain = gl.createVertexArray();
    gl.bindVertexArray(this.vaoTerrain);

    const mk = (loc, data, size) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return buf;
    };
    this._tPos = mk(0, pos, 3);
    this._tNrm = mk(1, nrm, 3);
    this._tCol = mk(2, col, 3);

    // NATION OVERLAY: a per-vertex tint buffer (rgb = nation color, a = strength).
    // Dynamic — refreshed from sim.territory whenever ownership changes. One vertex
    // per tile, same indexing as the heightmap, so updating it is a flat scan.
    this._owner = new Float32Array(nVerts * 4);   // all zero => no overlay initially
    this._tOwn = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._tOwn);
    gl.bufferData(gl.ARRAY_BUFFER, this._owner, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);

    this._tIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._tIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    this._ownerDirty = true;
  }

  // ------------------------------------------------------------- nation overlay
  // Refresh the per-vertex nation tint from sim.territory.owner. Called by the
  // adapter when ownership likely changed (cheap: one pass over tiles, then one
  // bufferSubData). hueOf(tribeId) -> 0..360 supplied by the adapter so colors
  // match the rest of the game; falls back to the tribe's own hue.
  updateTerritory(hueOf) {
    const T = this.sim.territory;
    if (!T || !this._owner) return;
    const owner = T.owner, W = this.world, w = W.w, h = W.h;
    const out = this._owner;
    const cache = this._ownRGB || (this._ownRGB = new Map());
    for (let i = 0; i < w * h; i++) {
      const id = owner[i];
      const o = i * 4;
      if (!id) { out[o] = 0; out[o+1] = 0; out[o+2] = 0; out[o+3] = 0; continue; }
      let c = cache.get(id);
      if (!c) {
        const tr = this.sim.tribes.get(id);
        const hue = hueOf ? hueOf(id) : (tr ? tr.hue : 210);
        c = hsl2rgb(hue, 0.78, 0.55); cache.set(id, c);
      }
      out[o] = c.r; out[o+1] = c.g; out[o+2] = c.b;
      // border detection: stronger tint where a neighbour tile is a different owner
      const x = i % w, y = (i / w) | 0;
      let edge = 0;
      if (x === 0 || owner[i-1] !== id) edge = 1;
      else if (x === w-1 || owner[i+1] !== id) edge = 1;
      else if (y === 0 || owner[i-w] !== id) edge = 1;
      else if (y === h-1 || owner[i+w] !== id) edge = 1;
      out[o+3] = edge ? 1.0 : 0.4;   // bright border band, soft interior fill
    }
    const gl = this.gl;
    gl.bindVertexArray(this.vaoTerrain);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._tOwn);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this._ownerDirty = false;
  }

  // ------------------------------------------------------------- water plane
  _buildWater() {
    const gl = this.gl;
    // one quad (two triangles) in 0..1 XZ space; the VS maps it across the world
    const quad = new Float32Array([0,0, 1,0, 1,1,  0,0, 1,1, 0,1]);
    this.vaoWater = gl.createVertexArray();
    gl.bindVertexArray(this.vaoWater);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this._waterBuf = buf;
  }

  // ------------------------------------------------------------- sprite VAO
  // One unit quad (corner attrib, divisor 0) + an instance buffer (divisor 1)
  // holding pos(3) + data(4) + meta(2) + anim(3) = 12 floats per instance. The
  // extra anim vector (phase, speed, packedState) lets the whole crowd walk/strike/
  // carry/die in ONE draw call, animated in-shader from uTime.
  _buildSpriteQuad() {
    const gl = this.gl;
    const corners = new Float32Array([
      -0.5,-0.5,  0.5,-0.5,  0.5,0.5,
      -0.5,-0.5,  0.5,0.5,  -0.5,0.5,
    ]);
    this.vaoSprite = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSprite);

    const cbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // instance buffer (dynamic)
    this._instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf);
    const stride = 12 * 4;
    // iPos (loc 1) : 3 floats
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    // iData (loc 2) : 4 floats  (size, r, g, b)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribDivisor(2, 1);
    // iMeta (loc 3) : 2 floats  (kind, bright)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 7 * 4);
    gl.vertexAttribDivisor(3, 1);
    // iAnim (loc 4) : 3 floats  (phase, speed, packedState)
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 9 * 4);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------- building box VAO
  // A unit box (XZ in -0.5..0.5, Y in 0..1) with per-face normals, plus a dynamic
  // instance buffer: iBase(3) + iSize(4: footX,height,footZ,roofKind) + iColor(3)
  // = 10 floats/instance. Whole skyline = ONE instanced draw call.
  _buildBoxMesh() {
    const gl = this.gl;
    // 24 verts (4 per face), positions + normals; 36 indices. Y up, box stands on 0.
    const P = [], Nr = [];
    const face = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz) => {
      P.push(ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz);
      for (let k = 0; k < 4; k++) Nr.push(nx, ny, nz);
    };
    const a = 0.5;
    // top (+Y)
    face(-a,1,-a,  a,1,-a,  a,1, a, -a,1, a,  0,1,0);
    // bottom (-Y) (rarely seen; keep for cull correctness)
    face(-a,0, a,  a,0, a,  a,0,-a, -a,0,-a,  0,-1,0);
    // +X
    face( a,0,-a,  a,1,-a,  a,1, a,  a,0, a,  1,0,0);
    // -X
    face(-a,0, a, -a,1, a, -a,1,-a, -a,0,-a, -1,0,0);
    // +Z
    face( a,0, a,  a,1, a, -a,1, a, -a,0, a,  0,0,1);
    // -Z
    face(-a,0,-a, -a,1,-a,  a,1,-a,  a,0,-a,  0,0,-1);
    const idx = [];
    for (let f = 0; f < 6; f++) { const o = f*4; idx.push(o,o+1,o+2, o,o+2,o+3); }

    this.vaoBuild = gl.createVertexArray();
    gl.bindVertexArray(this.vaoBuild);
    const pbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Nr), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    // instance buffer (dynamic): 10 floats/instance
    this._buildInstBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buildInstBuf);
    const stride = 10 * 4;
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 0);  gl.vertexAttribDivisor(2, 1); // iBase
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 12); gl.vertexAttribDivisor(3, 1); // iSize
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 28); gl.vertexAttribDivisor(4, 1); // iColor

    this._boxIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._boxIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this._boxCount = idx.length;
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------- trees (baked)
  // Scan the heightmap ONCE for FOREST tiles and bake a forest of swaying tree
  // billboards into a static instance buffer. Per-instance: world pos + size, plus
  // (phase, hueShift) so each tree sways out of phase and varies in tint. The whole
  // forest is ONE instanced draw call; sway is entirely in-shader (free per frame).
  _buildTrees() {
    const gl = this.gl, W = this.world, w = W.w, h = W.h, biome = W.biome;
    const ox = -this.cx, oz = -this.cz;
    // deterministic hash for stable placement/jitter (no per-frame churn)
    const hash = (n) => { let x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
    // budget: subsample dense forests so huge maps stay cheap (target <~6k trees).
    const forestTiles = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (biome[y * w + x] === BIOME.FOREST) forestTiles.push(y * w + x);
    }
    const cap = 6000;
    const stepN = Math.max(1, Math.ceil(forestTiles.length / cap));
    const list = [];
    for (let k = 0; k < forestTiles.length; k += stepN) {
      const i = forestTiles[k];
      const x = i % w, y = (i / w) | 0;
      // 1–2 trees per kept tile, jittered within the tile for an organic clump
      const cnt = hash(i * 1.7) > 0.45 ? 2 : 1;
      for (let c = 0; c < cnt; c++) {
        const jx = (hash(i + c * 31.1) - 0.5) * 0.8;
        const jz = (hash(i + c * 57.7) - 0.5) * 0.8;
        const wx = x + 0.5 + jx, wz = y + 0.5 + jz;
        const gy = this.heightAt(wx, wz);
        const size = 2.4 + hash(i + c * 91.3) * 2.2;
        list.push(wx + ox, gy, wz + oz, size, hash(i + c * 7.0), hash(i + c * 19.0));
      }
    }
    this._treeCount = (list.length / 6) | 0;
    const data = new Float32Array(list);

    if (this.vaoTree) gl.deleteVertexArray(this.vaoTree);
    this.vaoTree = gl.createVertexArray();
    gl.bindVertexArray(this.vaoTree);
    // shared corner quad
    const corners = new Float32Array([-0.5,-0.5, 0.5,-0.5, 0.5,0.5, -0.5,-0.5, 0.5,0.5, -0.5,0.5]);
    const cbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // baked instance buffer: iPos(4) + iVar(2) = 6 floats
    const ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);  gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this._treeBuf = ibuf;
  }

  // ------------------------------------------------------------- smoke quad
  // A shared corner quad + a dynamic instance buffer of smoke-puff sources. Each
  // settlement seeds a small column of puffs (rise/drift/fade animated in-shader).
  // Rebuilt only when the settlement set changes — not per frame.
  _buildSmokeQuad() {
    const gl = this.gl;
    if (this.vaoSmoke) gl.deleteVertexArray(this.vaoSmoke);
    this.vaoSmoke = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSmoke);
    const corners = new Float32Array([-0.5,-0.5, 0.5,-0.5, 0.5,0.5, -0.5,-0.5, 0.5,0.5, -0.5,0.5]);
    const cbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this._smokeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._smokeBuf);
    // iPos(4): x, baseY, z, seed
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this._smokeCount = 0;
    this._smokeKey = -1;        // forces a (re)build on first draw
  }

  // (re)bake the smoke instance buffer from current settlements (PUFFS_PER stacks).
  _rebuildSmoke() {
    const gl = this.gl, sim = this.sim, S = sim.settlements;
    const ox = -this.cx, oz = -this.cz;
    const PUFFS = 5;
    const n = Math.min(S.length, 400);    // cap columns for huge worlds
    const data = new Float32Array(n * PUFFS * 4);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const s = S[i];
      const tier = (typeof s.tier === 'number') ? s.tier : 0;
      // chimney sits a touch above the rooftops, near the settlement centre
      const baseY = this.heightAt(s.x, s.y) + 2.0 + tier * 0.6;
      const wx = s.x + 0.5 + ox, wz = s.y + 0.5 + oz;
      for (let p = 0; p < PUFFS; p++) {
        data[o] = wx; data[o+1] = baseY; data[o+2] = wz;
        data[o+3] = (i * 0.37 + p / PUFFS) % 1;   // staggered loop seed
        o += 4;
      }
    }
    this._smokeCount = n * PUFFS;
    gl.bindVertexArray(this.vaoSmoke);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._smokeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this._smokeKey = S.length;
  }

  _ensureBuild(n) {
    const need = n * 10;
    if (!this._buildInst || this._buildInst.length < need) {
      let cap = this._buildInst ? this._buildInst.length : 2048;
      while (cap < need) cap <<= 1;
      this._buildInst = new Float32Array(cap);
    }
    return this._buildInst;
  }

  _ensureInst(n) {
    const need = n * 12;
    if (!this._inst || this._inst.length < need) {
      let cap = this._inst ? this._inst.length : 4096;
      while (cap < need) cap <<= 1;
      this._inst = new Float32Array(cap);
      this._instCap = (cap / 12) | 0;
    }
    return this._inst;
  }

  // terrain height (world Y) at a continuous tile coordinate — for placing sprites
  heightAt(tx, ty) {
    const W = this.world, w = W.w, h = W.h, elev = W.elev;
    let x = tx | 0, y = ty | 0;
    if (x < 0) x = 0; else if (x >= w) x = w - 1;
    if (y < 0) y = 0; else if (y >= h) y = h - 1;
    let yy = elev[y * w + x] * HEIGHT_SCALE;
    if (yy < this.seaY) yy = this.seaY;   // things on/over water sit at sea level
    return yy;
  }

  // ------------------------------------------------------------- resize
  resize(cssW, cssH, dpr = 1) {
    const gl = this.gl;
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw; this.canvas.height = ph;
    }
    this.cssW = cssW; this.cssH = cssH;
    gl.viewport(0, 0, pw, ph);
  }

  // ------------------------------------------------------------- render a frame
  // cam: { dist, yaw, pitch, targetX, targetZ }  in world units (see Camera3D).
  render(cam) {
    const gl = this.gl;
    if (this.lost) return;
    const W = this.world;
    const aspect = (this.canvas.width / this.canvas.height) || 1;

    // --- camera: orbit around target on the terrain ---
    const tx = (cam.targetX ?? this.cx) - this.cx;   // world-centered
    const tz = (cam.targetZ ?? this.cz) - this.cz;
    const ty = (cam.targetY ?? this.seaY);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw),  sy = Math.sin(cam.yaw);
    // eye on a sphere of radius dist around (tx,ty,tz)
    const ex = tx + cam.dist * cp * sy;
    const ey = ty + cam.dist * sp;
    const ez = tz + cam.dist * cp * cy;

    const far = cam.dist * 3 + W.w + W.h;
    M.perspective(this._proj, cam.fov ?? (Math.PI / 4), aspect, 0.5, far);
    M.lookAt(this._view, ex, ey, ez, tx, ty, tz, 0, 1, 0);
    M.mul(this._vp, this._proj, this._view);
    // inverse view-proj for screen->world picking (computed once per frame)
    if (!this._vpInvBuf) this._vpInvBuf = new Float32Array(16);
    this._vpInv = M.invert(this._vpInvBuf, this._vp) ? this._vpInvBuf : null;
    this._lastCam = cam;

    // camera basis vectors (for billboard facing) — rows of the view matrix
    const v = this._view;
    const camRight = [v[0], v[4], v[8]];
    const camUp    = [v[1], v[5], v[9]];

    // ---- DAY-NIGHT CYCLE: a smooth sun ARC across the sky over the day, driving
    //      the light direction AND the sky/ambient/fog palette (dawn → noon → dusk
    //      → night → dawn). Everything eases; nothing snaps. ----
    const t = (this.sim.tick || 0);
    this._dayT = (t * 0.0006) % (Math.PI * 2);    // full day ~ every ~10k ticks
    const day = this._dayT;
    // sun rises in the east (+X), arcs overhead, sets in the west. elevation = sin.
    const elev = Math.sin(day);                    // -1 (midnight) .. +1 (noon)
    const azim = Math.cos(day);                    // E/W sweep
    let sx = azim, syy = Math.max(0.06, elev * 0.95 + 0.05), sz = 0.45 * Math.cos(day * 0.5 + 0.7);
    const sl = Math.hypot(sx, syy, sz) || 1;
    const sun = [sx/sl, syy/sl, sz/sl];
    // daylight factor 0 night .. 1 noon (smooth), plus a golden-hour weight near 0.
    const dayl = Math.max(0, elev);                          // 0 below horizon
    const daylight = Math.min(1, dayl * 1.6 + 0.06);         // ambient floor at night
    const golden = Math.max(0, 1 - Math.abs(elev) * 4) * Math.max(0, Math.sign(elev) + 0.4);
    this._daylight = daylight; this._golden = golden;

    // sky color: night indigo → dawn/dusk warm → day blue. mix by daylight + golden.
    const night = [0.05, 0.07, 0.14], dayC = [0.52, 0.64, 0.80], warm = [0.86, 0.55, 0.40];
    const sky = [
      night[0] + (dayC[0]-night[0])*daylight + warm[0]*golden*0.5,
      night[1] + (dayC[1]-night[1])*daylight + warm[1]*golden*0.4,
      night[2] + (dayC[2]-night[2])*daylight + warm[2]*golden*0.25,
    ];
    // sun light color: warm gold at horizon, neutral-bright at noon, dim blue night.
    const sunCol = [
      0.35 + daylight*0.7 + golden*0.55,
      0.38 + daylight*0.62 + golden*0.25,
      0.46 + daylight*0.46 - golden*0.10,
    ];
    // ambient: cool sky-bounce, lifts with daylight (never pure black at night).
    const amb = [
      0.10 + daylight*0.30, 0.12 + daylight*0.32, 0.18 + daylight*0.36,
    ];
    this._sun = sun; this._sunCol = sunCol; this._amb = amb;

    const fogColor = [sky[0]*0.92+0.04, sky[1]*0.92+0.05, sky[2]*0.92+0.06];
    const fogNear = cam.dist * 0.9;
    const fogFar  = far * 0.85;
    this._fogColor = fogColor; this._fogNear = fogNear; this._fogFar = fogFar;
    this._animTime = t;
    // clouds drift slowly across the map (NW→SE), independent of the sun.
    this._cloudX = t * 0.22;
    this._cloudZ = t * 0.10;

    gl.clearColor(sky[0], sky[1], sky[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- TERRAIN ---
    gl.useProgram(this.progTerrain);
    gl.uniformMatrix4fv(this.uTerrain.uViewProj, false, this._vp);
    gl.uniform3fv(this.uTerrain.uSunDir, sun);
    gl.uniform3fv(this.uTerrain.uSunColor, sunCol);
    gl.uniform3fv(this.uTerrain.uAmbient, amb);
    gl.uniform3fv(this.uTerrain.uFogColor, fogColor);
    gl.uniform1f(this.uTerrain.uFogNear, fogNear);
    gl.uniform1f(this.uTerrain.uFogFar, fogFar);
    gl.uniform1f(this.uTerrain.uOverlay, this.overlay ?? 0.85);
    gl.uniform1f(this.uTerrain.uTime, t);
    gl.uniform2f(this.uTerrain.uCloud, this._cloudX || 0, this._cloudZ || 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaoTerrain);
    gl.drawElements(gl.TRIANGLES, this._terrainCount, gl.UNSIGNED_INT, 0);

    // --- TREES (baked forest billboards, sway in-shader) ---
    this._drawTrees(camRight, camUp, sunCol, amb, fogColor, fogNear, fogFar);

    // --- BUILDINGS (procedural extruded skyline, instanced, lit + shadowed) ---
    this._drawBuildings(sun, fogColor, fogNear, fogFar);

    // --- SPRITES (figures: agents/soldiers/boats + far-zoom city banners) ---
    this._drawSprites(camRight, camUp, fogColor, fogNear, fogFar);

    // --- WATER (translucent, drawn last, depth-tested but no depth write) ---
    gl.useProgram(this.progWater);
    gl.uniformMatrix4fv(this.uWater.uViewProj, false, this._vp);
    gl.uniform2f(this.uWater.uWorldMin, -this.cx, -this.cz);
    gl.uniform2f(this.uWater.uWorldSize, W.w, W.h);
    gl.uniform1f(this.uWater.uSeaY, this.seaY);
    gl.uniform1f(this.uWater.uTime, t * 0.05);
    gl.uniform3fv(this.uWater.uSunDir, sun);
    gl.uniform3fv(this.uWater.uFogColor, fogColor);
    gl.uniform1f(this.uWater.uFogNear, fogNear);
    gl.uniform1f(this.uWater.uFogFar, fogFar);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vaoWater);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // --- CHIMNEY SMOKE (rising puffs, translucent, depth-tested, no depth write) ---
    this._drawSmoke(camRight, camUp);

    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------- sprites
  // Build the per-instance array on the CPU (shadows first so they draw under the
  // bodies), distance-culling agents far outside the camera target, then ONE
  // instanced draw call. This is the scale win: 2000-5000 agents = 1 draw call.
  //
  // ANIMATION: per agent we also pack (phase, speed, state) into iAnim so the GPU
  // walks/strikes/carries/dies the whole crowd from one uTime uniform. The CPU only
  // writes flat floats — no per-agent objects, no per-limb math here. `state` packs
  //   facing (heading angle/τ in the fraction) + carry/combat/fade flags in the int
  // part, decoded in the vertex shader.
  _drawSprites(camRight, camUp, fogColor, fogNear, fogFar) {
    const gl = this.gl, sim = this.sim, W = this.world;
    const A = sim.pool.agents, n = A.length;
    const ox = -this.cx, oz = -this.cz;

    // cull radius around camera target (world tiles); beyond it agents are dropped
    const camR = ((this._lastCamDist || 60) * 1.6 + 40);
    const ctx2 = (this._lastTargetX ?? this.cx);
    const ctz2 = (this._lastTargetZ ?? this.cz);
    const camR2 = camR * camR;

    const inst = this._ensureInst(n + sim.settlements.length + 64);
    let head = 0;   // float write head

    // renderer-owned animation state (NEVER mutates the sim). Keyed by agent slot:
    //  _combatPulse : decays a strike pulse (1→0) — re-armed when a fights this tick
    //  _faceHold    : last travel heading (rad) so a stopped agent keeps facing,
    //                 not snapping to 0 when velocity vanishes.
    if (!this._combatPulse || this._combatPulse.length < n) {
      this._combatPulse = new Float32Array(n);
      this._faceHold = new Float32Array(n);
    }
    const pulse = this._combatPulse, faceHold = this._faceHold;
    // frame dt for pulse decay (clock from sim tick; ~constant-rate, robust enough)
    const nowT = (this.sim.tick || 0);
    const dPulse = 0.10;   // strike pulse fades over ~10 combat-free frames (eased)

    // animation time (seconds-ish): drives all gait/breath phases in-shader.
    const animTime = nowT * 0.05;

    // tribe hue -> rgb cache (cheap, rebuilt per frame from a small Map)
    const hueRGB = this._hueCache || (this._hueCache = new Map());
    const hueOf = this._hueOf;   // adapter-supplied override (player accents etc.)

    const pushSprite = (wx, wy, wz, size, r, g, b, kind, bright, phase, speed, state) => {
      const o = head;
      inst[o] = wx; inst[o+1] = wy; inst[o+2] = wz;
      inst[o+3] = size; inst[o+4] = r; inst[o+5] = g; inst[o+6] = b;
      inst[o+7] = kind; inst[o+8] = bright;
      inst[o+9] = phase; inst[o+10] = speed; inst[o+11] = state;
      head += 12;
    };

    const TAU = Math.PI * 2;
    // pack facing(0..1) + flags into one float the VS decodes:
    //   fract = facing ; +1 carry ; +(combat*2) ; +(fade*8)
    const packState = (facing01, carry, combat3, fade15) =>
      facing01 + carry + combat3 * 2 + fade15 * 8;

    // FIGURES: shadow (flat disc) + an articulated billboard standing on the ground.
    // kind 0 = civilian, 3 = soldier (warrior/ranger), 4 = boat/vehicle crew.
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      if (!a.alive) { pulse[i] = 0; continue; }
      const dx = a.x - ctx2, dz = a.y - ctz2;
      if (dx*dx + dz*dz > camR2) continue;     // distance cull
      const gy = this.heightAt(a.x, a.y);
      const wx = a.x + 0.5 + ox, wz = a.y + 0.5 + oz;

      // tribe color
      const tr = sim.tribes.get(a.tribeId);
      const hue = hueOf ? hueOf(a.tribeId) : (tr ? tr.hue : a.hue);
      let rgb = hueRGB.get(a.tribeId);
      if (!rgb || rgb.h !== hue) {
        rgb = hsl2rgb(hue, 0.60, 0.56); rgb.h = hue;
        hueRGB.set(a.tribeId, rgb);
      }
      const bright = 0.55 + (a.energy * 0.7 + a.health * 0.3) * 0.6;
      const size = 1.5 + a.size * 1.0;        // figures are a touch taller than the old discs
      // role/vehicle decides the silhouette kind + a small tint shift
      let kind = 0, rr = rgb.r, gg = rgb.g, bb = rgb.b;
      if (a.vehicle === 1 || a.vehicle === 2) { kind = 4; }            // boat/plane crew
      else if (a.role === 1 || a.role === 2) { kind = 3;               // soldier — steel-shift
        rr = rgb.r*0.7 + 0.18; gg = rgb.g*0.7 + 0.18; bb = rgb.b*0.7 + 0.22; }

      // --- ANIMATION INPUTS (all read-only from the agent) ---
      // speed: 0 idle .. 1 run, from velocity magnitude (eased into a 0..1 ramp).
      const spd = Math.min(1, Math.hypot(a.vx, a.vy) * 2.2);
      // facing: heading of travel; hold last heading when basically still.
      let heading;
      if (spd > 0.06) { heading = Math.atan2(a.vy, a.vx); faceHold[i] = heading; }
      else heading = faceHold[i];
      let facing01 = (heading / TAU) % 1; if (facing01 < 0) facing01 += 1;
      // per-agent phase from id → the crowd walks out of phase in one draw call.
      const phase = ((a.id * 0.61803398875) % 1 + 1) % 1;
      // combat pulse: consume the one-frame attack flag (the renderer contract —
      // every sibling renderer reads+clears lastAct) and re-arm a decaying strike.
      if (a.lastAct === 2) { pulse[i] = 1; a.lastAct = 0; }
      else if (a.lastAct === 1) { a.lastAct = 0; }
      else if (pulse[i] > 0) { pulse[i] = Math.max(0, pulse[i] - dPulse); }
      const combat3 = pulse[i] > 0.66 ? 3 : pulse[i] > 0.33 ? 2 : pulse[i] > 0.02 ? 1 : 0;
      // carry: holding a hauled resource
      const carry = (a.carryType >= 0) ? 1 : 0;
      // fade: 1 alive .. 0 dying (health near 0 sinks + dissolves the figure)
      const fade15 = Math.max(0, Math.min(15, Math.round(Math.min(1, a.health * 1.6) * 15)));
      const state = packState(facing01, carry, combat3, fade15);

      // shadow (flat, on the ground) — sized to the footprint, not the height. It
      // gets speed in its anim slot so it can pulse subtly with each footfall.
      pushSprite(wx, gy + 0.05, wz, size * 0.7, 0, 0, 0, 2, 1, phase, spd, 0);
      // figure (articulated billboard, stands up from the ground)
      pushSprite(wx, gy, wz, size, rr, gg, bb, kind, bright, phase, spd, state);
      drawn++;
      if (head + 24 > inst.length) break;   // safety (buffer cap)
    }

    // far-zoom city banner dots (the readable settlement marker when zoomed way
    // out and the box skyline is too small to see). Only emit when pulled back.
    if ((this._lastCamDist || 0) > 90) {
      const S = sim.settlements;
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        const gy = this.heightAt(s.x, s.y);
        const wx = s.x + 0.5 + ox, wz = s.y + 0.5 + oz;
        const tr = sim.tribes.get(s.tribeId);
        const hue = hueOf ? hueOf(s.tribeId) : (tr ? tr.hue : 205);
        const rgb = hsl2rgb(hue, 0.62, 0.66);
        const tier = (typeof s.tier === 'number') ? s.tier : 0;
        const size = 2.6 + tier * 1.2;
        pushSprite(wx, gy + 3.5 + tier * 2, wz, size, rgb.r, rgb.g, rgb.b, 1, 1.0, 0, 0, 0);
        if (head + 12 > inst.length) break;
      }
    }

    const instances = (head / 12) | 0;
    this._lastDrawn = drawn;
    if (instances === 0) return;

    // upload + draw in ONE call
    gl.useProgram(this.progSprite);
    gl.uniformMatrix4fv(this.uSprite.uViewProj, false, this._vp);
    gl.uniform3fv(this.uSprite.uCamRight, camRight);
    gl.uniform3fv(this.uSprite.uCamUp, camUp);
    gl.uniform1f(this.uSprite.uTime, animTime);
    gl.uniform1f(this.uSprite.uPxScale, 1.0);
    gl.uniform3fv(this.uSprite.uFogColor, fogColor);
    gl.uniform1f(this.uSprite.uFogNear, fogNear);
    gl.uniform1f(this.uSprite.uFogFar, fogFar);

    gl.bindVertexArray(this.vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, head), gl.DYNAMIC_DRAW);

    // shadows blend; bodies are opaque. Since they share one buffer, enable blend
    // (shadow alpha < 1, body alpha = 1) and keep depth writes on so 3D order holds.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);     // billboards/ground quads: both faces visible
    gl.depthMask(true);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instances);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  // ------------------------------------------------------------- trees (draw)
  // ONE instanced draw call for the whole swaying forest. The instance buffer is
  // baked (static); per-frame cost is just the uniform set + draw. Alpha-blended so
  // the canopy/trunk silhouette reads cleanly; depth-written so figures occlude.
  _drawTrees(camRight, camUp, sunCol, amb, fogColor, fogNear, fogFar) {
    const gl = this.gl;
    if (!this._treeCount) return;
    gl.useProgram(this.progTree);
    gl.uniformMatrix4fv(this.uTree.uViewProj, false, this._vp);
    gl.uniform3fv(this.uTree.uCamRight, camRight);
    gl.uniform3fv(this.uTree.uCamUp, camUp);
    gl.uniform1f(this.uTree.uTime, (this._animTime || 0) * 0.05);
    gl.uniform3fv(this.uTree.uFogColor, fogColor);
    gl.uniform1f(this.uTree.uFogNear, fogNear);
    gl.uniform1f(this.uTree.uFogFar, fogFar);
    gl.uniform3fv(this.uTree.uSunColor, sunCol);
    gl.uniform3fv(this.uTree.uAmbient, amb);
    gl.bindVertexArray(this.vaoTree);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this._treeCount);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------- smoke (draw)
  // Rising chimney puffs. Instance buffer rebaked only when settlements change; the
  // rise/drift/expand/fade is all in-shader, so per-frame cost is one draw call.
  _drawSmoke(camRight, camUp) {
    const gl = this.gl;
    if (this._smokeKey !== this.sim.settlements.length) this._rebuildSmoke();
    if (!this._smokeCount) return;
    gl.useProgram(this.progSmoke);
    gl.uniformMatrix4fv(this.uSmoke.uViewProj, false, this._vp);
    gl.uniform3fv(this.uSmoke.uCamRight, camRight);
    gl.uniform3fv(this.uSmoke.uCamUp, camUp);
    gl.uniform1f(this.uSmoke.uTime, (this._animTime || 0) * 0.05);
    gl.uniform1f(this.uSmoke.uNight, 1.0 - (this._daylight ?? 1.0));
    gl.bindVertexArray(this.vaoSmoke);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);                 // smoke doesn't occlude; draws over
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this._smokeCount);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------- buildings
  // Build an instanced skyline from sim.settlements. Each settlement's `buildings`
  // list (deterministic offsets from SettlementSystem._layout) becomes a cluster of
  // extruded boxes; type → footprint + height + roof kind, tribe → wall tint. The
  // whole world's skyline is ONE instanced draw call.
  _drawBuildings(sun, fogColor, fogNear, fogFar) {
    const gl = this.gl, sim = this.sim;
    const S = sim.settlements;
    if (!S || S.length === 0) { this._lastBuildings = 0; return; }
    const ox = -this.cx, oz = -this.cz;
    const hueOf = this._hueOf;

    // size every cluster once to bound the buffer (cap defensively).
    let total = 0;
    for (let i = 0; i < S.length; i++) total += (S[i].buildings ? S[i].buildings.length : 0) + 1;
    if (total > 4000) total = 4000;
    const inst = this._ensureBuild(total);
    let head = 0;

    const push = (bx, gy, bz, fx, hgt, fz, roof, r, g, b) => {
      const o = head;
      inst[o]=bx; inst[o+1]=gy; inst[o+2]=bz;
      inst[o+3]=fx; inst[o+4]=hgt; inst[o+5]=fz; inst[o+6]=roof;
      inst[o+7]=r; inst[o+8]=g; inst[o+9]=b;
      head += 10;
    };

    // type → { footprint, height, roofKind }. era/tier already chose the type set
    // in SettlementSystem; we just give each archetype a believable 3D mass.
    // roofKind: 0 flat, 1 pitched (terracotta), 2 pale (civic landmark)
    const SPEC = {
      hut:      [1.0, 1.4, 0], house:   [1.3, 2.2, 1], block:   [1.5, 3.0, 0],
      granary:  [1.6, 2.6, 1], workshop:[1.8, 2.4, 0], temple:  [2.0, 4.2, 2],
      market:   [2.2, 2.0, 1], wall:    [1.2, 2.0, 0], smithy:  [1.7, 2.6, 0],
      keep:     [2.6, 5.5, 2], tower:   [1.4, 6.5, 2], cathedral:[2.6, 7.0, 2],
      factory:  [3.0, 3.4, 0],
    };

    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const blds = s.buildings;
      if (!blds || !blds.length) continue;
      const tr = sim.tribes.get(s.tribeId);
      const hue = hueOf ? hueOf(s.tribeId) : (tr ? tr.hue : 210);
      // walls are a desaturated, lightened version of the banner hue (stone-tinted)
      const wall = hsl2rgb(hue, 0.22, 0.62);
      for (let k = 0; k < blds.length; k++) {
        const bld = blds[k];
        const spec = SPEC[bld.type] || SPEC.hut;
        const wx = s.x + bld.dx, wz = s.y + bld.dy;
        const gy = this.heightAt(wx, wz);
        // slight per-building jitter in height (hashed via offset) so a row of
        // huts isn't perfectly uniform — reads as organic.
        const jit = 0.8 + ((Math.abs(bld.dx * 13.1 + bld.dy * 7.7) % 1));
        push(wx + ox, gy, wz + oz, spec[0], spec[1] * jit, spec[0], spec[2],
             wall.r, wall.g, wall.b);
        if (head >= inst.length) break;
      }
      if (head >= inst.length) break;
    }

    const instances = (head / 10) | 0;
    this._lastBuildings = instances;
    if (instances === 0) return;

    gl.useProgram(this.progBuild);
    gl.uniformMatrix4fv(this.uBuild.uViewProj, false, this._vp);
    gl.uniform3fv(this.uBuild.uSunDir, sun);
    gl.uniform3fv(this.uBuild.uSunColor, this._sunCol || [1.05, 1.0, 0.92]);
    gl.uniform3fv(this.uBuild.uAmbient, this._amb || [0.40, 0.44, 0.52]);
    gl.uniform3fv(this.uBuild.uFogColor, fogColor);
    gl.uniform1f(this.uBuild.uFogNear, fogNear);
    gl.uniform1f(this.uBuild.uFogFar, fogFar);
    gl.uniform1f(this.uBuild.uNight, 1.0 - (this._daylight ?? 1.0));

    gl.bindVertexArray(this.vaoBuild);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buildInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, head), gl.DYNAMIC_DRAW);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.drawElementsInstanced(gl.TRIANGLES, this._boxCount, gl.UNSIGNED_SHORT, 0, instances);
    gl.bindVertexArray(null);
  }

  setCamInfo(cam) {
    this._lastCamDist = cam.dist;
    this._lastTargetX = cam.targetX;
    this._lastTargetZ = cam.targetZ;
    this._lastCam = cam;
  }

  // ------------------------------------------------------------- picking
  // Raycast a screen pixel onto the terrain, returning the world TILE coord {x,y}
  // (sim space, NOT centered) it hits, or null if the ray misses the ground. Used
  // by the adapter so the integrator can wire click-to-select agents/cities. We
  // unproject the pixel through the last frame's view-proj, then march the ray and
  // bisect against the heightmap (cheap, robust, no GPU readback).
  screenToWorld(screenX, screenY, cam = this._lastCam) {
    if (!cam || !this._vpInv) return null;
    const cw = this.canvas.width, ch = this.canvas.height;
    // pixel -> NDC (-1..1); screenX/Y are CSS px so scale by dpr we baked into the
    // backing store. cssW/cssH come from resize().
    const px = (screenX / (this.cssW || cw)) * 2 - 1;
    const py = 1 - (screenY / (this.cssH || ch)) * 2;
    // unproject a near + far point through the inverse view-proj
    const near = unproject(this._vpInv, px, py, -1);
    const far  = unproject(this._vpInv, px, py,  1);
    if (!near || !far) return null;
    let ax = near[0], ay = near[1], az = near[2];
    const bx = far[0], by = far[1], bz = far[2];
    let dx = bx-ax, dy = by-ay, dz = bz-az;
    const len = Math.hypot(dx, dy, dz) || 1; dx/=len; dy/=len; dz/=len;
    // march in world units; sample terrain height, find the sign change, bisect
    const ox = -this.cx, oz = -this.cz;
    const sampleH = (wx, wz) => this.heightAt(wx - ox, wz - oz);   // wx,wz centered
    let t = 0, prev = ay - sampleH(ax, az);
    const maxT = len * 1.2, step = Math.max(0.5, this.world.w * 0.01);
    for (t = step; t < maxT; t += step) {
      const wx = ax + dx*t, wy = ay + dy*t, wz = az + dz*t;
      const cur = wy - sampleH(wx, wz);
      if (cur <= 0 && prev > 0) {                 // crossed the surface — bisect
        let lo = t - step, hi = t;
        for (let it = 0; it < 16; it++) {
          const mid = (lo+hi)*0.5;
          const mh = (ay+dy*mid) - sampleH(ax+dx*mid, az+dz*mid);
          if (mh <= 0) hi = mid; else lo = mid;
        }
        const ht = (lo+hi)*0.5;
        const hx = ax + dx*ht, hz = az + dz*ht;
        // back to sim tile coords (uncentre, undo the +0.5 tile-centre offset)
        return { x: (hx - ox) - 0.5, y: (hz - oz) - 0.5 };
      }
      prev = cur;
    }
    return null;
  }

  dispose() {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    try {
      gl.deleteProgram(this.progTerrain);
      gl.deleteProgram(this.progWater);
      gl.deleteProgram(this.progSprite);
      gl.deleteProgram(this.progBuild);
      gl.deleteProgram(this.progTree);
      gl.deleteProgram(this.progSmoke);
      if (this.vaoTerrain) gl.deleteVertexArray(this.vaoTerrain);
      if (this.vaoWater) gl.deleteVertexArray(this.vaoWater);
      if (this.vaoSprite) gl.deleteVertexArray(this.vaoSprite);
      if (this.vaoBuild) gl.deleteVertexArray(this.vaoBuild);
      if (this.vaoTree) gl.deleteVertexArray(this.vaoTree);
      if (this.vaoSmoke) gl.deleteVertexArray(this.vaoSmoke);
    } catch { /* context already gone */ }
  }
}

// hsl (h in degrees, s/l 0..1) -> {r,g,b} in 0..1
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2(p, q, h + 1/3);
    g = hue2(p, q, h);
    b = hue2(p, q, h - 1/3);
  }
  return { r, g, b };
}
function hue2(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

// ----------------------------------------------------------------- orbit camera
// A tiny plain-data orbit camera the demo page drives from pointer/wheel input.
// dist = distance from target, yaw/pitch = orbit angles, target = world tile coord.
export class Camera3D {
  constructor(world) {
    this.world = world;
    this.targetX = world.w / 2;
    this.targetZ = world.h / 2;
    this.targetY = world.seaLevel * HEIGHT_SCALE + 4;
    this.dist = Math.max(world.w, world.h) * 0.8;
    this.yaw = 0.0;            // rotate around target
    this.pitch = 0.92;         // ~53° down-tilt (Civ-style)
    this.fov = Math.PI / 4;
    // smoothing targets
    this.tDist = this.dist; this.tYaw = this.yaw; this.tPitch = this.pitch;
    this.tX = this.targetX; this.tZ = this.targetZ;
    this.minDist = 8; this.maxDist = Math.max(world.w, world.h) * 1.6;
    this.minPitch = 0.30; this.maxPitch = 1.45;   // never fully top-down or below ground
  }

  orbit(dYaw, dPitch) {
    this.tYaw += dYaw;
    this.tPitch = clamp(this.tPitch + dPitch, this.minPitch, this.maxPitch);
  }

  zoomBy(factor) {
    this.tDist = clamp(this.tDist * factor, this.minDist, this.maxDist);
  }

  // pan in the camera's ground plane (screen-right / screen-forward)
  pan(dRight, dForward) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // forward = projection of view dir onto ground; right = perpendicular
    this.tX += (-cy * dForward + sy * dRight);
    this.tZ += ( sy * dForward + cy * dRight);
    const w = this.world;
    this.tX = clamp(this.tX, -10, w.w + 10);
    this.tZ = clamp(this.tZ, -10, w.h + 10);
  }

  update() {
    const k = 0.18;
    this.dist += (this.tDist - this.dist) * k;
    this.yaw  += (this.tYaw  - this.yaw)  * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    this.targetX += (this.tX - this.targetX) * k;
    this.targetZ += (this.tZ - this.targetZ) * k;
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export { HEIGHT_SCALE };
