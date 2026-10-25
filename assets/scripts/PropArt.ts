import { _decorator, Component, Node, Mesh, MeshRenderer, Material, Color, utils } from 'cc';

const { ccclass, property } = _decorator;
type Point = [number, number, number];
type RGB = [number, number, number];
const jade: RGB = [58, 139, 127];
const ink: RGB = [29, 69, 77];
const gold: RGB = [222, 169, 72];
const moon: RGB = [223, 239, 224];
const cyan: RGB = [89, 209, 221];

/** Flat normals and independent face vertices keep the facets crisp at the game camera angle. */
class Surface {
    positions: number[] = [];
    normals: number[] = [];
    colors: number[] = [];
    indices: number[] = [];

    face(points: Point[], color: RGB, outward: Point) {
        const a = points[0], b = points[1], c = points[2];
        const u = b.map((v, i) => v - a[i]);
        const v = c.map((n, i) => n - a[i]);
        let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        if (n.reduce((sum, val, i) => sum + val*outward[i], 0) < 0) {
            points = [...points].reverse();
            n = n.map(val => -val);
        }
        const len = Math.hypot(...n);
        if (len < 1e-8) return;
        const start = this.positions.length / 3;
        for (const p of points) {
            this.positions.push(...p);
            this.normals.push(...n.map(val => val / len));
            this.colors.push(...color.map(val => val / 255), 1);
        }
        for (let i = 1; i < points.length - 1; i++) this.indices.push(start, start+i, start+i+1);
    }

    box(x: number, y: number, z: number, w: number, h: number, d: number, color: RGB) {
        const p: Point[] = [];
        for (const yy of [-1, 1]) for (const zz of [-1, 1]) for (const xx of [-1, 1])
            p.push([x+xx*w/2, y+yy*h/2, z+zz*d/2]);
        const faces = [[0,1,3,2], [4,6,7,5], [0,4,5,1], [2,3,7,6], [0,2,6,4], [1,5,7,3]];
        const normals: Point[] = [[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]];
        faces.forEach((f, i) => this.face(f.map(j => p[j]), shade(color, [0.6,1,0.72,0.88,0.75,0.95][i]), normals[i]));
    }

    ring(radius: number, inner: number, low: number, high: number, color: RGB, teeth = false) {
        const count = teeth ? 24 : 16;
        const at = (i: number, r: number, y: number): Point => {
            const angle = i / count * Math.PI*2;
            return [Math.cos(angle)*r, y, Math.sin(angle)*r];
        };
        for (let i = 0; i < count; i++) {
            const j = i+1;
            const topA = high + (teeth && i%3 === 1 ? 0.26 : 0);
            const topB = high + (teeth && j%3 === 1 ? 0.26 : 0);
            const normal: Point = [Math.cos((i+0.5)/count*Math.PI*2),0,Math.sin((i+0.5)/count*Math.PI*2)];
            const a = at(i,radius,low), b = at(j,radius,low);
            const c = at(j,radius,topB), d = at(i,radius,topA);
            const e = at(i,inner,low), f = at(j,inner,low);
            const g = at(j,inner,topB), h = at(i,inner,topA);
            this.face([a,b,c,d],shade(color, i%3 === 0 ? 0.78 : 1),normal);
            this.face([e,h,g,f],shade(color,0.6),normal.map(n => -n) as Point);
            this.face([d,c,g,h],shade(color,1.12),[0,1,0]);
            this.face([a,e,f,b],shade(color,0.6),[0,-1,0]);
        }
    }

    mesh(): Mesh {
        return utils.createMesh(this, undefined, { calculateBounds: true });
    }
}

function shade(c: RGB, k: number): RGB { return c.map(v => Math.min(255,v*k)) as RGB; }
interface SharedShape { solid: Mesh; glass?: Mesh; users: number; }
const shapes = new Map<string, SharedShape>();
interface FloorPalette { material: Material; users: number; }
const floorPalettes = new Map<Material, FloorPalette>();
const orbPalettes = new Map<Material, FloorPalette>();
let floorColor = new Color(242,220,154,255);

/** Chamfered stone slab with a recessed frame and short corner inlays.
 * Everything fits inside the original unit tile; top remains at local Y=0.5.
 * Neutral face shades tint with the shared seven-theme floor material.
 */
function ordinaryTile(s: Surface) {
    const outline = (r: number, cut: number, y: number): Point[] => [
        [-r+cut,y,-r],[r-cut,y,-r],[r,y,-r+cut],[r,y,r-cut],
        [r-cut,y,r],[-r+cut,y,r],[-r,y,r-cut],[-r,y,-r+cut],
    ];
    const bottom = outline(0.495,0.028,-0.5);
    const shoulder = outline(0.495,0.028,0.39);
    const top = outline(0.477,0.026,0.49);
    for (let i = 0; i < 8; i++) {
        const j = (i+1)%8;
        const normal: Point = [bottom[i][0]+bottom[j][0],0,bottom[i][2]+bottom[j][2]];
        s.face([bottom[i],bottom[j],shoulder[j],shoulder[i]],[163,163,163],normal);
        // Physical bevel: the camera-facing edges catch a little more light.
        const value = i < 3 ? 210 : 228;
        s.face([shoulder[i],shoulder[j],top[j],top[i]],[value,value,value],[normal[0],1,normal[2]]);
    }
    s.face([...bottom],[145,145,145],[0,-1,0]);
    s.face(top,[240,240,240],[0,1,0]);

    const frame = (outer: number, inner: number, y: number, color: RGB) => {
        const a = outline(outer,0.025,y), b = outline(inner,0.021,y);
        for (let i = 0; i < 8; i++) {
            const j = (i+1)%8;
            s.face([a[i],a[j],b[j],b[i]],color,[0,1,0]);
        }
    };
    // Fine outer lip, inset dark groove, then a narrow light return into the tile face.
    // These are opaque coplanar strips at distinct heights, not extra renderers.
    frame(0.476,0.468,0.493,[219,219,219]);
    frame(0.451,0.437,0.495,[174,174,174]);
    frame(0.437,0.431,0.497,[251,251,251]);

    // Quiet L-shaped corner joints, inspired by framed paving stones.
    // No icons or central motifs that might imply special-tile behavior.
    for (const x of [-1,1]) for (const z of [-1,1]) {
        const strip = (x0: number,z0: number,x1: number,z1: number) => {
            s.face([[x*x0,0.499,z*z0],[x*x1,0.499,z*z0],
                [x*x1,0.499,z*z1],[x*x0,0.499,z*z1]],[200,200,200],[0,1,0]);
        };
        strip(0.350,0.407,0.413,0.413);
        strip(0.407,0.350,0.413,0.407);
    }
}

/** Front-facing reliefs retain real thickness inside the existing thin emitter hit box. */
function ringZ(s: Surface,x: number,y: number,z: number,r: number,inner: number,depth: number,color: RGB) {
    const t = new Surface();
    t.ring(r,inner,-depth/2,depth/2,color);
    for (let i = 0; i < t.positions.length; i += 3) {
        const yy = t.positions[i+1], zz = t.positions[i+2];
        t.positions[i] += x; t.positions[i+1] = zz+y; t.positions[i+2] = -yy+z;
        const ny = t.normals[i+1], nz = t.normals[i+2];
        t.normals[i+1] = nz; t.normals[i+2] = -ny;
    }
    append(s,t);
}

function relief(s: Surface,outline: number[][],back: number,front: number,color: RGB) {
    const a: Point[] = outline.map(p => [p[0],p[1],back]);
    const b: Point[] = outline.map(p => [p[0],p[1],front]);
    s.face(a,shade(color,0.6),[0,0,-1]);
    s.face(b,color,[0,0,1]);
    const cx = outline.reduce((sum,p) => sum+p[0],0)/outline.length;
    const cy = outline.reduce((sum,p) => sum+p[1],0)/outline.length;
    for (let i = 0; i < a.length; i++) {
        const j = (i+1)%a.length;
        s.face([a[i],a[j],b[j],b[i]],shade(color,i%2 ? 0.72 : 0.85),
            [a[i][0]+a[j][0]-cx*2,a[i][1]+a[j][1]-cy*2,0]);
    }
}

function lens(s: Surface,y: number,r: number,edge: number,front: number,color: RGB) {
    for (let i = 0; i < 16; i++) {
        const a = i*Math.PI/8, b = (i+1)*Math.PI/8;
        s.face([[Math.cos(a)*r,y+Math.sin(a)*r,edge],
            [Math.cos(b)*r,y+Math.sin(b)*r,edge],[0,y,front]],
            shade(color,i%3 === 0 ? 1.08 : i%3 === 1 ? 0.91 : 1),[0,0,1]);
    }
}

function jadeOrb(s: Surface) {
    const radius = 0.54, centerY = 0.81;
    const at = (i: number,j: number): Point => {
        const lat = -Math.PI/2+i*Math.PI/8, a = j*Math.PI/8;
        return [Math.cos(a)*Math.cos(lat)*radius,centerY+Math.sin(lat)*radius,
            Math.sin(a)*Math.cos(lat)*radius];
    };
    for (let i = 0; i < 8; i++) for (let j = 0; j < 16; j++) {
        const a = at(i,j), b = at(i,j+1), c = at(i+1,j+1), d = at(i+1,j);
        const normal: Point = [a[0]+c[0],a[1]+c[1]-centerY*2,a[2]+c[2]];
        const color: RGB = i > 4 ? [152,220,177] : [73,172,144];
        if (i === 0) s.face([a,c,d],color,normal);
        else if (i === 7) s.face([a,b,c],color,normal);
        else s.face([a,b,c,d],color,normal);
    }
}

function build(kind: string): SharedShape {
    const s = new Surface();
    let glass: Mesh | undefined;
    if (kind === 'diamond') {
        const at = (i: number, r: number, y: number): Point => [Math.cos(i*Math.PI/4)*r,y,Math.sin(i*Math.PI/4)*r];
        const top: Point[] = [];
        for (let i = 0; i < 8; i++) {
            const a = at(i,0.52,1.18), b = at(i+1,0.52,1.18);
            const c = at(i+1,0.30,1.49), d = at(i,0.30,1.49);
            const n: Point = [Math.cos((i+0.5)*Math.PI/4),0,Math.sin((i+0.5)*Math.PI/4)];
            s.face([a,b,c],shade(cyan,i%2 ? 1 : 0.74),[n[0],1,n[2]]);
            s.face([a,c,d],shade(cyan,i%2 ? 0.83 : 1.12),[n[0],1,n[2]]);
            s.face([[0,0,0],b,a],shade(cyan,i%2 ? 0.65 : 0.9),[n[0],-0.3,n[2]]);
            top.push(d);
        }
        s.face(top, [173,239,237], [0,1,0]);
    } else if (kind === 'crown') {
        s.ring(0.49,0.36,0.96,1.17,gold,true);
        s.ring(0.5,0.35,0.92,0.99,shade(gold,0.8));
        for (let i = 0; i < 3; i++) {
            const a = i*Math.PI*2/3 + Math.PI/2;
            jewel(s,Math.cos(a)*0.47,1.075,Math.sin(a)*0.47,0.065,[194,77,88]);
        }
    } else if (kind === 'mountain') {
        // Circular footprint remains inside the existing cone collision envelope.
        const tip: Point = [0,1,0];
        const at = (i: number, r: number, y: number): Point => [Math.cos(i*Math.PI/4)*r,y,Math.sin(i*Math.PI/4)*r];
        for (let i = 0; i < 8; i++) {
            const a = at(i,0.5,0), b = at(i+1,0.5,0);
            const c = at(i+1,0.28,0.44), d = at(i,0.28,0.44);
            const n: Point = [a[0]+b[0],0.2,a[2]+b[2]];
            s.face([a,b,c],shade(ink,i%2 ? 1.3 : 1),n);
            s.face([a,c,d],shade(jade,i%2 ? 0.8 : 1),n);
            s.face([d,c,tip],shade(jade,i%3 === 0 ? 1.25 : 0.88),n);
            s.face([[0,0,0],b,a],ink,[0,-1,0]);
        }
    } else if (kind === 'tile') {
        ordinaryTile(s);
    } else if (kind === 'glass' || kind === 'jump') {
        const isGlass = kind === 'glass';
        // Special tiles retain their cyan/orange identification colors.
        s.box(0,-0.04,0,0.99,0.92,0.99,kind === 'jump' ? [181,96,44] : [44,117,135]);
        const rim: RGB = isGlass ? [131,220,226] : gold;
        for (const x of [-0.475,0.475]) s.box(x,0.48,0,0.026,0.04,0.98,rim);
        for (const z of [-0.475,0.475]) s.box(0,0.48,z,0.93,0.04,0.026,rim);
        if (isGlass) {
            // One top pane, depth-tested without depth writes. Opaque rim/body always remain legible.
            const pane = new Surface();
            pane.face([[-0.45,0.478,-0.45],[-0.45,0.478,0.45],[0.45,0.478,0.45],[0.45,0.478,-0.45]],cyan,[0,1,0]);
            glass = pane.mesh();
            for (const x of [-0.36,0.36]) s.box(x,0.482,0,0.012,0.008,0.72,[74,167,181]);
        } else if (kind === 'jump') {
            // Two raised chevrons point towards forward (-Z), entirely inside the cell.
            for (const z of [-0.12,0.18]) {
                s.face([[-0.29,0.505,z+0.08],[0,0.505,z-0.14],[0,0.505,z-0.04],[-0.29,0.505,z+0.18]],moon,[0,1,0]);
                s.face([[0,0.505,z-0.14],[0.29,0.505,z+0.08],[0.29,0.505,z+0.18],[0,0.505,z-0.04]],moon,[0,1,0]);
            }
        }
    } else if (kind === 'teleport') {
        // Reference: the original jade energy orb and golden carp, rather than a stone doorway.
        s.ring(0.43,0.32,0.025,0.075,[65,122,104]);
        s.ring(0.40,0.37,0.078,0.09,[213,184,111]);
        ringZ(s,0,0.81,0,0.61,0.59,0.025,[208,186,113]);
        // Two curved jade/gold ribbons wrap the sides; center stays open to the translucent orb.
        for (const sign of [-1,1]) {
            for (let i = 0; i < 9; i++) {
                const a = -1.15+i*0.23, b = a+0.23;
                const point = (angle: number,r: number): Point =>
                    [sign*Math.cos(angle)*r,0.81+Math.sin(angle)*r,0.08+0.06*Math.sin(angle*2)];
                s.face([point(a,0.585),point(b,0.585),point(b,0.56),point(a,0.56)],
                    i%3 === 0 ? [236,217,150] : [149,191,145],[0,0,1]);
            }
        }
        const carp: RGB = [248,211,113];
        relief(s,[[-0.18,0.76],[-0.12,0.90],[0.14,1.01],[0.27,0.95],[0.18,0.82],[-0.03,0.73]],-0.03,0.15,carp);
        relief(s,[[-0.16,0.78],[-0.36,0.85],[-0.29,0.61]],-0.025,0.105,[222,180,91]);
        relief(s,[[-0.03,0.89],[-0.05,1.06],[0.10,0.98]],0.015,0.09,[246,228,163]);
        relief(s,[[0.02,0.79],[0.03,0.64],[0.17,0.83]],0.02,0.13,[235,191,90]);
        relief(s,[[-0.13,0.80],[0.06,0.94],[0.20,0.94],[0.08,0.84]],0.151,0.155,[255,241,184]);
        jewel(s,0.19,0.945,0.16,0.018,[91,113,84]);
        for (const p of [[-0.24,1.13,-0.02],[0.32,0.59,0.1],[-0.12,0.4,0.08]])
            jewel(s,p[0],p[1],p[2],0.035,[247,228,162]);
        const orb = new Surface(); jadeOrb(orb); glass = orb.mesh();
    } else if (kind === 'emitter') {
        // Ruin machine eye: dark concentric armor, bronze inner rings and four pointed shutters.
        // Unit diameter/height; fitEmitter maps the relief's full depth to the existing hit box.
        ringZ(s,0,0.5,0,0.50,0.445,0.19,[65,55,48]);
        ringZ(s,0,0.5,0.005,0.443,0.355,0.13,[115,94,67]);
        ringZ(s,0,0.5,0.04,0.356,0.323,0.055,[185,144,83]);
        lens(s,0.5,0.322,0.055,0.086,[210,139,62]);
        for (let i = 0; i < 4; i++) {
            const angle = i*Math.PI/2;
            const rotate = (x: number,y: number) =>
                [x*Math.cos(angle)-y*Math.sin(angle),0.5+x*Math.sin(angle)+y*Math.cos(angle)];
            relief(s,[rotate(-0.045,0.47),rotate(0.045,0.47),rotate(0.069,0.28),
                rotate(0,0.17),rotate(-0.069,0.28)],0.065,0.107,[103,83,58]);
            relief(s,[rotate(-0.012,0.41),rotate(0.012,0.41),rotate(0.019,0.29),
                rotate(0,0.255),rotate(-0.019,0.29)],0.108,0.112,[192,154,92]);
        }
        jewel(s,0,0.5,0.089,0.037,[255,214,119]);
    } else if (kind === 'beam') {
        s.box(0,0,0,1,1,1,[250,118,65]);
        // White-hot core lives inside the hazard envelope, without widening its silhouette.
        s.box(0,0.495,0,0.34,0.01,1,[255,232,181]);
    } else if (kind === 'emitterSignal') {
        lens(s,0,0.312,0,0.002,[255,190,78]);
        lens(s,0,0.16,0.002,0.004,[255,229,157]);
        lens(s,0,0.062,0.004,0.006,[255,250,222]);
    }
    return { solid:s.mesh(), glass, users:0 };
}

function append(a: Surface,b: Surface) {
    const offset = a.positions.length/3;
    a.positions.push(...b.positions); a.normals.push(...b.normals); a.colors.push(...b.colors);
    a.indices.push(...b.indices.map(i => i+offset));
}
function jewel(s: Surface,x: number,y: number,z: number,r: number,c: RGB) {
    const p: Point[] = [[x+r,y,z],[x,y,z+r],[x-r,y,z],[x,y,z-r]];
    for (let i = 0; i < 4; i++) {
        const a = p[i], b = p[(i+1)%4];
        s.face([a,b,[x,y+r,z]],shade(c,i%2 ? 1 : 0.8),[a[0]-x,1,a[2]-z]);
        s.face([b,a,[x,y-r,z]],shade(c,0.7),[a[0]-x,-1,a[2]-z]);
    }
}

/** Serialized on the existing prefabs: UUIDs and all gameplay bindings stay intact.
 * No animation clocks: pause, reset, pooling and culling follow the existing parent nodes.
 * One cached mesh per shape, one shared palette material. Last user releases each GPU mesh.
 */
@ccclass('PropArt')
export class PropArt extends Component {
    @property kind = 'tile';
    @property(Material) palette: Material | null = null;
    @property(Material) glassMaterial: Material | null = null;
    private acquired: string[] = [];
    private built = false;
    private signal: Node | null = null;
    private floorSource: Material | null = null;
    private orbSource: Material | null = null;

    private acquireOrbPalette(): Material {
        const source = this.glassMaterial!;
        let entry = orbPalettes.get(source);
        if (!entry) {
            const material = new Material(); material.copy(source);
            // A lighter shell keeps the golden fish readable through the jade tint.
            material.setProperty('mainColor',new Color(255,255,255,95));
            entry = { material,users:0 }; orbPalettes.set(source,entry);
        }
        entry.users++; this.orbSource = source;
        return entry.material;
    }

    /** All pooled ordinary tiles share a single tinted material per source palette. */
    public static setFloorTheme(color: Readonly<Color>) {
        floorColor = new Color(color.r,color.g,color.b,255);
        for (const entry of floorPalettes.values()) entry.material.setProperty('mainColor',floorColor);
    }

    private acquireFloorPalette(): Material {
        const source = this.palette!;
        let entry = floorPalettes.get(source);
        if (!entry) {
            const material = new Material();
            material.copy(source);
            material.setProperty('mainColor',floorColor);
            entry = { material,users:0 };
            floorPalettes.set(source,entry);
        }
        entry.users++;
        this.floorSource = source;
        return entry.material;
    }

    onLoad() { this.ensureBuilt(); }

    public ensureBuilt() {
        if (this.built || !this.palette) return;
        this.built = true;
        for (const r of this.node.getComponentsInChildren(MeshRenderer)) r.enabled = false;
        const shape = this.acquire(this.kind);
        const model = this.node.getChildByName('Model');
        if ((this.kind === 'mountain' || this.kind === 'emitter') && model) {
            const r = model.getComponent(MeshRenderer)!;
            r.mesh = shape.solid; r.setSharedMaterial(this.palette,0); r.enabled = true;
            model.setPosition(0,0,0); model.setScale(1,1,1); model.setRotationFromEuler(0,0,0);
        } else {
            this.render('LandscapeArt',shape.solid,this.kind === 'tile' ? this.acquireFloorPalette() : this.palette);
        }
        if (shape.glass && this.glassMaterial)
            this.render(this.kind === 'teleport' ? 'JadeEnergyOrb' : 'GlassPane',shape.glass,
                this.kind === 'teleport' ? this.acquireOrbPalette() : this.glassMaterial);
        if (this.kind === 'emitter') {
            this.signal = this.render('FiringSignal',this.acquire('emitterSignal').solid,this.palette);
            this.signal.setPosition(0,0.5,0.087);
            this.signal.active = false;
            // Keep it in the Model coordinate system so fitting also adapts the signal.
            this.signal.parent = model!;
        }
    }

    public setFiring(firing: boolean) { if (this.signal) this.signal.active = firing; }
    private acquire(kind: string) {
        let shape = shapes.get(kind);
        if (!shape) { shape = build(kind); shapes.set(kind,shape); }
        shape.users++; this.acquired.push(kind);
        return shape;
    }
    private render(name: string,mesh: Mesh,material: Material): Node {
        const n = new Node(name); n.layer = this.node.layer; n.parent = this.node;
        const r = n.addComponent(MeshRenderer); r.mesh = mesh; r.setSharedMaterial(material,0);
        return n;
    }
    onDestroy() {
        if (this.orbSource) {
            const entry = orbPalettes.get(this.orbSource)!;
            if (--entry.users === 0) { entry.material.destroy(); orbPalettes.delete(this.orbSource); }
        }
        if (this.floorSource) {
            const entry = floorPalettes.get(this.floorSource)!;
            if (--entry.users === 0) {
                entry.material.destroy();
                floorPalettes.delete(this.floorSource);
            }
        }
        for (const kind of this.acquired) {
            const shape = shapes.get(kind)!;
            if (--shape.users === 0) { shape.solid.destroy(); shape.glass?.destroy(); shapes.delete(kind); }
        }
    }
}
