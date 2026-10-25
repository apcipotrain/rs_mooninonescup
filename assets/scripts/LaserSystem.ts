import {
    _decorator,
    Component,
    Node,
    Prefab,
    MeshRenderer,
    Vec3,
    instantiate,
} from 'cc';

import { RoadGenerator } from './RoadGenerator';
import { PropArt } from './PropArt';

const { ccclass, property } = _decorator;

interface GridPoint {
    row: number;
    col: number;
}

interface Segment {
    startRow: number;
    repeat?: number;
    ground: string[];
}

interface LaserMap {
    columns: number;
    tileSize: number;
    rowCount: number;
    defaultGround?: string;
    segments: Segment[];
    lasers?: GridPoint[];
}

@ccclass('LaserSystem')
export class LaserSystem extends Component {
    @property(RoadGenerator)
    road: RoadGenerator | null = null;

    @property(Prefab)
    emitterPrefab: Prefab | null = null;

    @property(Prefab)
    beamPrefab: Prefab | null = null;

    @property
    emitterWidth: number = 1.6;

    @property
    emitterHeight: number = 1.6;

    // 发射器贴图本体的逻辑碰撞厚度。
    @property
    emitterDepth: number = 0.2;

    @property
    beamWidth: number = 0.18;

    @property
    beamHeight: number = 0.18;

    // 光束中心离地高度。
    @property
    beamY: number = 0.8;

    private readonly triggerRows = 6;
    private readonly fireDuration = 2;

    private tileSize = 2;
    private rowCount = 0;

    private points: GridPoint[] = [];
    private starts = new Map<number, number>();

    private clock = 0;
    private loaded = false;
    private broken = false;

    private emitters: Node[] = [];
    private beams: Node[] = [];

    public ensureLoaded(): boolean {
        if (this.broken) {
            return false;
        }

        if (this.loaded) {
            return true;
        }

        try {
            const config =
                this.road?.levelData?.json as
                LaserMap | undefined;

            if (
                !config ||
                config.columns !== 5 ||
                !Number.isFinite(config.tileSize) ||
                config.tileSize <= 0 ||
                !Number.isInteger(config.rowCount) ||
                config.rowCount <= 0 ||
                !Array.isArray(config.segments)
            ) {
                throw new Error(
                    '请绑定有效的 Road 和地图',
                );
            }

            const dimensions = [
                this.emitterWidth,
                this.emitterHeight,
                this.emitterDepth,
                this.beamWidth,
                this.beamHeight,
            ];

            if (
                dimensions.some(
                    n => !Number.isFinite(n) || n <= 0,
                ) ||
                !Number.isFinite(this.beamY)
            ) {
                throw new Error('激光尺寸必须为正数');
            }

            const points = config.lasers ?? [];

            if (!Array.isArray(points)) {
                throw new Error('lasers 必须是数组');
            }

            const groundAt = (row: number): string => {
                let line =
                    config.defaultGround ?? '11111';

                for (const segment of config.segments) {
                    const offset =
                        row - segment.startRow;

                    if (
                        segment.ground.length > 0 &&
                        offset >= 0 &&
                        offset <
                        segment.ground.length *
                        (segment.repeat ?? 1)
                    ) {
                        line = segment.ground[
                            offset % segment.ground.length
                        ];
                    }
                }

                return line;
            };

            const seen = new Set<number>();
            const result: GridPoint[] = [];

            for (const point of points) {
                if (
                    !point ||
                    !Number.isInteger(point.row) ||
                    !Number.isInteger(point.col) ||
                    point.row < 0 ||
                    point.row >= config.rowCount ||
                    point.col < 0 ||
                    point.col >= 5
                ) {
                    throw new Error(
                        'lasers 存在无效行列坐标',
                    );
                }

                const id = point.row * 5 + point.col;

                if (seen.has(id)) {
                    throw new Error(
                        `激光坐标重复：${point.row},${point.col}`,
                    );
                }

                if (
                    !['1', '3', '5'].includes(
                        groundAt(point.row)[point.col],
                    )
                ) {
                    throw new Error(
                        `激光发射器 ${point.row},${point.col} ` +
                        '下方需要地板',
                    );
                }

                seen.add(id);

                result.push({
                    row: point.row,
                    col: point.col,
                });
            }

            if (
                result.length > 0 &&
                (!this.emitterPrefab || !this.beamPrefab)
            ) {
                throw new Error(
                    '请绑定 Emitter Prefab 和 Beam Prefab',
                );
            }

            this.points = result;
            this.tileSize = config.tileSize;
            this.rowCount = config.rowCount;
            this.loaded = true;

            return true;
        } catch (error) {
            console.error(
                'LaserSystem 配置错误：',
                error,
            );
            return false;
        }
    }

    start() {
        if (!this.ensureLoaded()) {
            return;
        }

        try {
            for (const point of this.points) {
                const emitter =
                    instantiate(this.emitterPrefab!);
                emitter.getComponent(PropArt)?.ensureBuilt();

                emitter.parent = this.road!.node;
                this.emitters.push(emitter);

                emitter.setPosition(
                    (point.col - 2) * this.tileSize,
                    0,
                    -point.row * this.tileSize,
                );

                this.fitEmitter(emitter);

                const beam =
                    instantiate(this.beamPrefab!);
                beam.getComponent(PropArt)?.ensureBuilt();

                beam.parent = this.road!.node;
                this.beams.push(beam);

                this.fitBeam(beam, point.col, point.row);
                beam.active = false;
            }

            this.refreshBeams();
	this.refreshVisibility();
        } catch (error) {
            for (
                const node of [
                    ...this.emitters,
                    ...this.beams,
                ]
            ) {
                node.destroy();
            }

            this.emitters = [];
            this.beams = [];
            this.broken = true;

            console.error(
                '激光预制体结构错误：',
                error,
            );
        }
    }

    // 自动把原本位于 XZ 平面的 Plane 竖起来，
    // 并按实际网格尺寸调整宽、高。
    private fitEmitter(root: Node) {
        if (root.getComponent(PropArt)) {
            const model = root.getChildByName('Model')!;
            const mesh = model.getComponent(MeshRenderer)!.mesh!;
            const min = mesh.struct.minPosition!, max = mesh.struct.maxPosition!;
            const sx = this.emitterWidth / (max.x-min.x);
            const sy = this.emitterHeight / (max.y-min.y);
            const sz = this.emitterDepth / (max.z-min.z);
            root.setScale(1,1,1); root.setRotationFromEuler(0,0,0);
            model.setRotationFromEuler(0,0,0); model.setScale(sx,sy,sz);
            model.setPosition(-(min.x+max.x)*0.5*sx,-min.y*sy,-(min.z+max.z)*0.5*sz);
            return;
        }
        const model = root.getChildByName('Model');

        const mesh =
            model?.getComponent(MeshRenderer)?.mesh;

        const min = mesh?.struct.minPosition;
        const max = mesh?.struct.maxPosition;

        if (
            !model ||
            !min ||
            !max ||
            max.x <= min.x ||
            max.z <= min.z
        ) {
            throw new Error(
                '发射器根节点需要直接子节点 Model，' +
                '使用 plane.mesh',
            );
        }

        const sx =
            this.emitterWidth / (max.x - min.x);

        const sz =
            this.emitterHeight / (max.z - min.z);

        root.setScale(1, 1, 1);
        root.setRotationFromEuler(0, 0, 0);

        model.setRotationFromEuler(90, 0, 0);
        model.setScale(sx, 1, sz);

        model.setPosition(
            -(min.x + max.x) * 0.5 * sx,
            this.emitterHeight * 0.5 +
                (min.z + max.z) * 0.5 * sz,
            -(min.y + max.y) * 0.5,
        );
    }

    // 光束预制体的根节点直接带 Cube MeshRenderer。
private fitBeam(
    root: Node,
    col: number,
    row: number,
) {
    const mesh =
        root.getComponent(MeshRenderer)?.mesh;

    const min = mesh?.struct.minPosition;
    const max = mesh?.struct.maxPosition;

    if (
        !min ||
        !max ||
        max.x <= min.x ||
        max.y <= min.y ||
        max.z <= min.z
    ) {
        throw new Error(
            'Beam Prefab 的根节点需要 Cube 网格和 MeshRenderer',
        );
    }

    // 用足够长的光束表现射线。
    const beamLength =
        this.rowCount * this.tileSize;

    // 起点为发射器，沿 Z 正方向延伸。
    const sourceZ = -row * this.tileSize;
    const centerZ = sourceZ + beamLength / 2;

    const sx =
        this.beamWidth / (max.x - min.x);

    const sy =
        this.beamHeight / (max.y - min.y);

    const sz =
        beamLength / (max.z - min.z);

    root.setRotationFromEuler(0, 0, 0);
    root.setScale(sx, sy, sz);

    root.setPosition(
        (col - 2) * this.tileSize -
            (min.x + max.x) * 0.5 * sx,

        this.beamY -
            (min.y + max.y) * 0.5 * sy,

        centerZ -
            (min.z + max.z) * 0.5 * sz,
    );
}

    public reset() {
    this.clock = 0;
    this.starts.clear();

    this.refreshBeams();
    this.refreshVisibility();
}

    // 纯查询：本段路径何时进入前方6行范围。
    private triggerFraction(
        point: GridPoint,
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
    ): number {
        const thresholdZ =
            -(point.row - this.triggerRows) *
            this.tileSize;

        if (from.z <= thresholdZ + 1e-9) {
            return 0;
        }

        if (
            to.z > thresholdZ + 1e-9 ||
            to.z >= from.z
        ) {
            return Infinity;
        }

        return Math.max(
            0,
            Math.min(
                1,
                (thresholdZ - from.z) /
                (to.z - from.z),
            ),
        );
    }

    // 球实际到达某位置后，才记录触发并推进时间。
    public advance(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        dt: number,
    ) {
        const duration = Math.max(0, dt);

        this.points.forEach((point, index) => {
            if (this.starts.has(index)) {
                return;
            }

            const fraction =
                this.triggerFraction(point, from, to);

            if (Number.isFinite(fraction)) {
                this.starts.set(
                    index,
                    this.clock + duration * fraction,
                );
            }
        });

        this.clock += duration;
        this.refreshBeams();
    }

    // 死亡等待期间只推进已有激光。
    public advanceTime(dt: number) {
        this.clock += Math.max(0, dt);
        this.refreshBeams();
    }

    private refreshBeams() {
        this.beams.forEach((beam, index) => {
            const start = this.starts.get(index);

            beam.active =
                start !== undefined &&
                this.clock >= start &&
                this.clock <
                start + this.fireDuration - 1e-9;
            this.emitters[index]?.getComponent(PropArt)?.setFiring(beam.active);
        });
    }

    // 返回首次碰撞比例；Infinity 表示安全。
    // 此方法不会修改计时或触发状态。
    public findHit(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        dt: number,
        ballRadius: number,
    ): number {
        const duration = Math.max(0, dt);
        const radius = Math.max(0, ballRadius);

        let first = Infinity;

        this.points.forEach((point, index) => {
            const x =
                (point.col - 2) * this.tileSize;

            // 发射器本体始终有碰撞。
            first = Math.min(
                first,
                this.sphereBoxHit(
                    from,
                    to,
                    radius,
                    x,
                    this.emitterHeight / 2,
                    -point.row * this.tileSize,
                    this.emitterWidth / 2,
                    this.emitterHeight / 2,
                    this.emitterDepth / 2,
                    0,
                    1,
                ),
            );

            let start = this.starts.get(index);

            if (start === undefined) {
                const trigger =
                    this.triggerFraction(
                        point,
                        from,
                        to,
                    );

                if (!Number.isFinite(trigger)) {
                    return;
                }

                start =
                    this.clock + trigger * duration;
            }

            let enter = 0;
            let exit = 1;

            if (duration === 0) {
                if (
                    this.clock < start ||
                    this.clock >=
                    start + this.fireDuration
                ) {
                    return;
                }
            } else {
                enter = Math.max(
                    0,
                    (start - this.clock) / duration,
                );

                exit = Math.min(
                    1,
                    (
                        start +
                        this.fireDuration -
                        this.clock
                    ) / duration,
                );

                if (
                    enter > exit ||
                    exit < 0 ||
                    enter > 1
                ) {
                    return;
                }
            }

const beamLength =
    this.rowCount * this.tileSize;

const sourceZ =
    -point.row * this.tileSize;

const centerZ =
    sourceZ + beamLength / 2;

const hit = this.sphereBoxHit(
    from,
    to,
    radius,
    x,
    this.beamY,
    centerZ,
    this.beamWidth / 2,
    this.beamHeight / 2,
    beamLength / 2,
    enter,
    exit,
);

            // 开始时生效，结束时不再致死。
            if (
                Number.isFinite(hit) &&
                this.clock + hit * duration <
                start + this.fireDuration - 1e-9
            ) {
                first = Math.min(first, hit);
            }
        });

        return first;
    }

    // 连续球-长方体检测。
    // 使用真实距离，避免把包围盒角落误算为球体接触。
    private sphereBoxHit(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        radius: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        minT: number,
        maxT: number,
    ): number {
        let enter = Math.max(0, minT);
        let exit = Math.min(1, maxT);

        const axes = [
            [from.x - cx, to.x - from.x, hx],
            [from.y - cy, to.y - from.y, hy],
            [from.z - cz, to.z - from.z, hz],
        ];

        for (const [origin, delta, half] of axes) {
            if (Math.abs(delta) < 1e-12) {
                if (
                    Math.abs(origin) >
                    half + radius
                ) {
                    return Infinity;
                }
            } else {
                let a =
                    (-half - radius - origin) / delta;

                let b =
                    (half + radius - origin) / delta;

                if (a > b) {
                    [a, b] = [b, a];
                }

                enter = Math.max(enter, a);
                exit = Math.min(exit, b);
            }

            if (enter > exit) {
                return Infinity;
            }
        }

        const distance = (t: number): number => {
            const x = Math.max(
                0,
                Math.abs(
                    from.x +
                    (to.x - from.x) * t -
                    cx,
                ) - hx,
            );

            const y = Math.max(
                0,
                Math.abs(
                    from.y +
                    (to.y - from.y) * t -
                    cy,
                ) - hy,
            );

            const z = Math.max(
                0,
                Math.abs(
                    from.z +
                    (to.z - from.z) * t -
                    cz,
                ) - hz,
            );

            return x * x + y * y + z * z;
        };

        const limit = radius * radius + 1e-10;

        if (distance(enter) <= limit) {
            return enter;
        }

        let lo = enter;
        let hi = exit;

        // 找路径上距离最近的位置。
        for (let i = 0; i < 40; i++) {
            const a = lo + (hi - lo) / 3;
            const b = hi - (hi - lo) / 3;

            if (distance(a) <= distance(b)) {
                hi = b;
            } else {
                lo = a;
            }
        }

        let nearest = (lo + hi) / 2;

        if (distance(exit) < distance(nearest)) {
            nearest = exit;
        }

        if (distance(nearest) > limit) {
            return Infinity;
        }

        lo = enter;
        hi = nearest;

        // 求首次接触的位置。
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;

            if (distance(mid) <= limit) {
                hi = mid;
            } else {
                lo = mid;
            }
        }

        return hi;
    }

private refreshVisibility() {
    if (!this.road) {
        return;
    }

    this.emitters.forEach((emitter, index) => {
        emitter.active = this.road!.isRowVisible(
            this.points[index].row,
        );
    });
}

lateUpdate() {
    this.refreshVisibility();
}

    onDestroy() {
        for (
            const node of [
                ...this.emitters,
                ...this.beams,
            ]
        ) {
            node.destroy();
        }

        this.emitters = [];
        this.beams = [];
    }
}
