import {
    _decorator,
    Component,
    JsonAsset,
    Prefab,
    Node,
    Vec3,
    MeshRenderer,
    instantiate,
} from 'cc';

const { ccclass, property } = _decorator;

interface GridPoint {
    row: number;
    col: number;
    height?: number;
}

interface MapSegment {
    startRow: number;
    repeat?: number;
    ground: string[];
}

interface LevelConfig {
    id: string;
    tileSize: number;
    columns: number;
    rowCount: number;
    defaultGround?: string;
    segments: MapSegment[];
    mountains?: GridPoint[];
    diamonds?: GridPoint[];
    crowns?: GridPoint[];
}

interface Collectible {
    kind: 'diamond' | 'crown';
    row: number;
    x: number;
    y: number;
    z: number;
    collected: boolean;
    view: Node | null;
}

interface CellView {
    nodes: Record<string, Node>;
    mountain: Node | null;
}

interface RowView {
    node: Node;
    cells: CellView[];
    mapRow: number;
}

export interface MovementResult {
    fraction: number;
    kind: 'none' | 'gap' | 'mountain';
    elapsed: number;
}

export interface JumpCrossing {
    fraction: number;
    row: number;
}

@ccclass('RoadGenerator')
export class RoadGenerator extends Component {
    @property(JsonAsset)
    levelData: JsonAsset | null = null;

    @property(Prefab)
    tilePrefab: Prefab | null = null;

    @property(Prefab)
    mountainPrefab: Prefab | null = null;

    @property(Prefab)
    glassSmallPrefab: Prefab | null = null;

    @property(Prefab)
    jumpPrefab: Prefab | null = null;

    @property(Prefab)
    diamondPrefab: Prefab | null = null;

    @property(Prefab)
    crownPrefab: Prefab | null = null;

    // 收集范围中心相对于地面的默认高度。
    @property
    collectibleHeight: number = 1.2;

    @property
    diamondPickupRadius: number = 0.35;

    @property
    crownPickupRadius: number = 0.5;

    @property(Node)
    player: Node | null = null;

    @property
    visibleRows: number = 40;

    @property
    rowsBehind: number = 6;

    @property
    edgeTolerance: number = 0.2;

    @property
    glassCollapseDelay: number = 0.36;

    @property
    glassFallDuration: number = 0.6;

    @property
    glassFallGravity: number = 20;

    @property
    mountainHitRadius: number = 0.9;

    @property
    mountainHeight: number = 1.8;

    private tileSize = 2;
    private columns = 5;
    private mapRows: string[] = [];
    private mountains = new Set<number>();
    private views: RowView[] = [];
    private collectibles: Collectible[] = [];

    private initialized = false;
    private glassTime = 0;
    private glassDeadlines = new Map<number, number>();

    public getTileSize(): number {
        return this.tileSize;
    }

    public resetGlass() {
        this.glassTime = 0;
        this.glassDeadlines.clear();
        this.refreshViews();
    }

    public advanceGlassTime(dt: number) {
        this.glassTime += Math.max(0, dt);
    }

    public getCollectibleStats() {
        return {
            totalDiamonds: this.collectibles.filter(
                item => item.kind === 'diamond',
            ).length,

            totalCrowns: this.collectibles.filter(
                item => item.kind === 'crown',
            ).length,

            collectedDiamonds: this.collectibles.filter(
                item => item.kind === 'diamond' && item.collected,
            ).length,

            collectedCrowns: this.collectibles.filter(
                item => item.kind === 'crown' && item.collected,
            ).length,
        };
    }

    public resetCollectibles() {
        for (const item of this.collectibles) {
            item.collected = false;
        }

        this.refreshCollectibles();
    }

    onLoad() {
        if (!this.levelData) {
            console.error('RoadGenerator：请绑定 Level Data');
            return;
        }

        try {
            this.readLevel(this.levelData.json as LevelConfig);
        } catch (error) {
            this.mapRows = [];
            this.collectibles = [];
            console.error('关卡 JSON 配置错误：', error);
        }
    }

    private validateLine(line: string, name: string) {
        if (
            typeof line !== 'string' ||
            line.length !== this.columns ||
            !/^[0135]+$/.test(line)
        ) {
            throw new Error(
                `${name} 必须是 ${this.columns} 位字符串，` +
                '仅支持 0、1、3、5；山峰请放到 mountains 列表',
            );
        }
    }

    private readLevel(config: LevelConfig) {
        if (!config || config.columns !== 5) {
            throw new Error('当前地图必须为 5 列');
        }

        if (
            !Number.isInteger(config.rowCount) ||
            config.rowCount <= 0 ||
            !Number.isFinite(config.tileSize) ||
            config.tileSize <= 0
        ) {
            throw new Error('rowCount 或 tileSize 不正确');
        }

        if (!Array.isArray(config.segments)) {
            throw new Error('segments 必须是数组');
        }

        this.columns = config.columns;
        this.tileSize = config.tileSize;

        const defaultGround = config.defaultGround ?? '11111';
        this.validateLine(defaultGround, 'defaultGround');
        this.mapRows = Array(config.rowCount).fill(defaultGround);

        const occupied = new Set<number>();

        config.segments.forEach((segment, index) => {
            if (
                !segment ||
                !Number.isInteger(segment.startRow) ||
                segment.startRow < 0 ||
                !Array.isArray(segment.ground) ||
                segment.ground.length === 0
            ) {
                throw new Error(`segments[${index}] 格式不正确`);
            }

            const repeat = segment.repeat ?? 1;

            if (!Number.isInteger(repeat) || repeat <= 0) {
                throw new Error(`segments[${index}].repeat 不正确`);
            }

            segment.ground.forEach((line, i) => {
                this.validateLine(
                    line,
                    `segments[${index}].ground[${i}]`,
                );
            });

            const end =
                segment.startRow + segment.ground.length * repeat;

            if (end > config.rowCount) {
                throw new Error(`segments[${index}] 超出总行数`);
            }

            for (let copy = 0; copy < repeat; copy++) {
                segment.ground.forEach((line, i) => {
                    const row =
                        segment.startRow +
                        copy * segment.ground.length +
                        i;

                    if (occupied.has(row)) {
                        throw new Error(`第 ${row} 行重复配置`);
                    }

                    occupied.add(row);
                    this.mapRows[row] = line;
                });
            }
        });

        this.mountains.clear();

        const readPoints = (
            name: string,
            points: GridPoint[] | undefined,
            requireGround: boolean = true,
        ): GridPoint[] => {
            if (points === undefined) {
                return [];
            }

            if (!Array.isArray(points)) {
                throw new Error(`${name} 必须是数组`);
            }

            const seen = new Set<number>();

            for (const point of points) {
                if (
                    !point ||
                    !Number.isInteger(point.row) ||
                    !Number.isInteger(point.col) ||
                    point.row < 0 ||
                    point.row >= this.mapRows.length ||
                    point.col < 0 ||
                    point.col >= this.columns
                ) {
                    throw new Error(`${name} 存在无效行列坐标`);
                }

                const id = point.row * this.columns + point.col;

                if (seen.has(id)) {
                    throw new Error(
                        `${name} 坐标重复：${point.row},${point.col}`,
                    );
                }

                if (
                    requireGround &&
                    this.mapRows[point.row][point.col] === '0'
                ) {
                    throw new Error(
                        `${name} 的 ${point.row},${point.col} ` +
                        '下方没有地板',
                    );
                }

                seen.add(id);
            }

            return points;
        };

        for (const point of readPoints('mountains', config.mountains)) {
            this.mountains.add(
                point.row * this.columns + point.col,
            );
        }

        this.collectibles = [];

        const addItems = (
            kind: 'diamond' | 'crown',
            points: GridPoint[],
        ) => {
            for (const point of points) {
                const height =
                    point.height ?? this.collectibleHeight;

                if (!Number.isFinite(height)) {
                    throw new Error('收集物 height 必须是有限数值');
                }

                this.collectibles.push({
                    kind,
                    row: point.row,
                    x: (point.col - 2) * this.tileSize,
                    y: height,
                    z: -point.row * this.tileSize,
                    collected: false,
                    view: null,
                });
            }
        };

        // 收集物允许悬空，不要求下方有地板。
        addItems(
            'diamond',
            readPoints('diamonds', config.diamonds, false),
        );

        addItems(
            'crown',
            readPoints('crowns', config.crowns, false),
        );

        console.log(
            `地图读取完成：${config.id}，${this.mapRows.length} 行`,
        );
    }

    start() {
        if (this.mapRows.length === 0) {
            return;
        }

        if (!this.player || !this.tilePrefab) {
            console.error(
                'RoadGenerator：请绑定 Player 和 Tile Prefab',
            );
            return;
        }

        const prefabs: Record<string, Prefab | null> = {
            '1': this.tilePrefab,
            '3': this.glassSmallPrefab,
            '5': this.jumpPrefab,
        };

        for (const type of ['1', '3', '5']) {
            if (
                this.mapRows.some(line => line.includes(type)) &&
                !prefabs[type]
            ) {
                console.error(
                    `RoadGenerator：地图含 ${type}，请绑定对应预制体`,
                );
                return;
            }
        }

        if (this.mountains.size > 0 && !this.mountainPrefab) {
            console.error(
                'RoadGenerator：请绑定独立山峰 Mountain Prefab',
            );
            return;
        }

        for (const kind of ['diamond', 'crown'] as const) {
            const prefab = kind === 'diamond'
                ? this.diamondPrefab
                : this.crownPrefab;

            if (
                this.collectibles.some(item => item.kind === kind) &&
                !prefab
            ) {
                console.error(
                    `RoadGenerator：请绑定 ${
                        kind === 'diamond' ? 'Diamond' : 'Crown'
                    } Prefab`,
                );
                return;
            }
        }

        if (this.mountains.size > 0 && this.mountainPrefab) {
            const probe = instantiate(this.mountainPrefab);

            try {
                this.fitMountain(probe);
            } catch (error) {
                console.error('山峰预制体配置错误：', error);
                probe.destroy();
                return;
            }

            probe.destroy();
        }

        const count = Math.min(
            Math.max(1, Math.floor(this.visibleRows)) +
                Math.max(0, Math.floor(this.rowsBehind)),
            this.mapRows.length,
        );

        for (let i = 0; i < count; i++) {
            const rowNode = new Node(`Row_${i}`);
            rowNode.parent = this.node;

            const cells: CellView[] = [];

            for (let col = 0; col < this.columns; col++) {
                const nodes: Record<string, Node> = {};

                for (const type of ['1', '3', '5']) {
                    const prefab = prefabs[type];

                    if (!prefab) {
                        continue;
                    }

                    const instance = instantiate(prefab);
                    instance.parent = rowNode;
                    instance.setPosition(
                        (col - 2) * this.tileSize,
                        -0.25,
                        0,
                    );

                    instance.active = false;
                    nodes[type] = instance;
                }

                let mountain: Node | null = null;

                if (
                    this.mountains.size > 0 &&
                    this.mountainPrefab
                ) {
                    mountain = instantiate(this.mountainPrefab);
                    mountain.parent = rowNode;
                    mountain.setPosition(
                        (col - 2) * this.tileSize,
                        0,
                        0,
                    );

                    this.fitMountain(mountain);
                    mountain.active = false;
                }

                cells.push({ nodes, mountain });
            }

            this.views.push({
                node: rowNode,
                cells,
                mapRow: -1,
            });
        }

        this.createCollectibles();
        this.initialized = true;

        this.updateRoad();
        this.refreshViews();
    }

    public getVisibleRowRange(): {
        first: number;
        last: number;
    } {
        if (!this.player || this.mapRows.length === 0) {
            return { first: 0, last: -1 };
        }

        const currentRow = Math.min(
            this.mapRows.length - 1,
            Math.floor(
                Math.max(0, -this.player.position.z) / this.tileSize,
            ),
        );

        return {
            first: Math.max(
                0,
                currentRow - Math.max(0, Math.floor(this.rowsBehind)),
            ),

            last: Math.min(
                this.mapRows.length - 1,
                currentRow +
                    Math.max(1, Math.floor(this.visibleRows)) -
                    1,
            ),
        };
    }

    public isRowVisible(row: number): boolean {
        const range = this.getVisibleRowRange();
        return row >= range.first && row <= range.last;
    }

    private updateRoad() {
        if (!this.player || this.views.length === 0) {
            return;
        }

        const range = this.getVisibleRowRange();
        const count = this.views.length;

        for (let i = 0; i < count; i++) {
            const mapRow = range.first + i;
            const view = this.views[mapRow % count];

            view.node.active = mapRow <= range.last;

            if (!view.node.active || view.mapRow === mapRow) {
                continue;
            }

            view.mapRow = mapRow;
            view.node.name = `Row_${mapRow}`;
            view.node.setPosition(0, 0, -mapRow * this.tileSize);
        }
    }

    private refreshViews() {
        const duration = Math.max(0.01, this.glassFallDuration);

        for (const view of this.views) {
            if (view.mapRow < 0) {
                continue;
            }

            const line = this.mapRows[view.mapRow];

            view.cells.forEach((cell, col) => {
                for (const type of Object.keys(cell.nodes)) {
                    const instance = cell.nodes[type];
                    let active = line[col] === type;
                    let y = -0.25;

                    if (type === '3') {
                        const id = view.mapRow * this.columns + col;
                        const deadline = this.glassDeadlines.get(id);

                        const age = deadline === undefined
                            ? -1
                            : this.glassTime - deadline;

                        active = active && age < duration;

                        if (age > 0) {
                            y -=
                                0.5 *
                                Math.max(0, this.glassFallGravity) *
                                age * age;
                        }
                    }

                    instance.active = active;
                    instance.setPosition(
                        (col - 2) * this.tileSize,
                        y,
                        0,
                    );
                }

                if (cell.mountain) {
                    const id = view.mapRow * this.columns + col;
                    const baseY =
                        this.mountainBaseY(view.mapRow, col);

                    cell.mountain.active =
                        this.mountains.has(id) && baseY !== null;

                    cell.mountain.setPosition(
                        (col - 2) * this.tileSize,
                        baseY ?? 0,
                        0,
                    );
                }
            });
        }
    }

    private fitMountain(root: Node) {
        const model = root.getChildByName('Model');
        const mesh = model?.getComponent(MeshRenderer)?.mesh;
        const min = mesh?.struct.minPosition;
        const max = mesh?.struct.maxPosition;

        if (!model || !min || !max) {
            throw new Error(
                '山峰需要直接子节点 Model，' +
                '并在其 MeshRenderer 中设置 cone.mesh',
            );
        }

        const width = max.x - min.x;
        const height = max.y - min.y;
        const depth = max.z - min.z;

        if (Math.min(width, height, depth) <= 0) {
            throw new Error('山峰网格尺寸无效');
        }

        const radius = Math.max(0.01, this.mountainHitRadius);
        const h = Math.max(0.01, this.mountainHeight);

        const sx = 2 * radius / width;
        const sy = h / height;
        const sz = 2 * radius / depth;

        root.setScale(1, 1, 1);
        root.setRotationFromEuler(0, 0, 0);

        model.setRotationFromEuler(0, 0, 0);
        model.setScale(sx, sy, sz);
        model.setPosition(
            -(min.x + max.x) * 0.5 * sx,
            -min.y * sy,
            -(min.z + max.z) * 0.5 * sz,
        );
    }

    private mountainBaseY(
        row: number,
        col: number,
    ): number | null {
        if (this.mapRows[row][col] !== '3') {
            return 0;
        }

        const deadline =
            this.glassDeadlines.get(row * this.columns + col);

        if (
            deadline === undefined ||
            this.glassTime <= deadline
        ) {
            return 0;
        }

        const age = this.glassTime - deadline;

        if (age >= Math.max(0.01, this.glassFallDuration)) {
            return null;
        }

        return (
            -0.5 *
            Math.max(0, this.glassFallGravity) *
            age * age
        );
    }

    public findJumpCrossing(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        ignoredRow: number,
    ): JumpCrossing | null {
        const half =
            this.tileSize / 2 + Math.max(0, this.edgeTolerance);

        const first = Math.max(
            0,
            Math.ceil(
                (-Math.max(from.z, to.z) - half) / this.tileSize,
            ),
        );

        const last = Math.min(
            this.mapRows.length - 1,
            Math.floor(
                (-Math.min(from.z, to.z) + half) / this.tileSize,
            ),
        );

        const config = this.levelData?.json as
            { teleports?: GridPoint[] } | undefined;

        const teleports = Array.isArray(config?.teleports)
            ? config!.teleports!
            : [];

        let best: JumpCrossing | null = null;

        for (let row = first; row <= last; row++) {
            if (row === ignoredRow) {
                continue;
            }

            for (let col = 0; col < this.columns; col++) {
                if (this.mapRows[row][col] !== '5') {
                    continue;
                }

                if (
                    teleports.some(
                        point => point.row === row && point.col === col,
                    )
                ) {
                    continue;
                }

                const interval = this.rectangleInterval(
                    from,
                    to,
                    (col - 2) * this.tileSize,
                    -row * this.tileSize,
                    half,
                );

                if (!interval) {
                    continue;
                }

                const fraction = interval[0];

                if (!best || fraction < best.fraction) {
                    best = { fraction, row };
                }
            }
        }

        return best;
    }

    public traceMovement(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        duration: number,
        ballRadius: number,
    ): MovementResult {
        const dt = Math.max(0, duration);
        const start = this.glassTime;

        const half =
            this.tileSize / 2 + Math.max(0, this.edgeTolerance);

        const first = Math.max(
            0,
            Math.ceil(
                (-Math.max(from.z, to.z) - half) / this.tileSize,
            ),
        );

        const last = Math.min(
            this.mapRows.length - 1,
            Math.floor(
                (-Math.min(from.z, to.z) + half) / this.tileSize,
            ),
        );

        const support: Array<[number, number]> = [];
        const pending: Array<{
            id: number;
            enter: number;
            deadline: number;
        }> = [];

        const delay = Math.max(0, this.glassCollapseDelay);

        for (let row = first; row <= last; row++) {
            for (let col = 0; col < this.columns; col++) {
                const type = this.mapRows[row][col];

                if (type === '0') {
                    continue;
                }

                const interval = this.rectangleInterval(
                    from,
                    to,
                    (col - 2) * this.tileSize,
                    -row * this.tileSize,
                    half,
                );

                if (!interval) {
                    continue;
                }

                const enter = interval[0];
                let exit = interval[1];

                if (type === '3') {
                    const id = row * this.columns + col;
                    let deadline = this.glassDeadlines.get(id);

                    if (deadline === undefined) {
                        deadline = start + enter * dt + delay;
                        pending.push({ id, enter, deadline });
                    }

                    if (dt === 0) {
                        if (deadline <= start) {
                            continue;
                        }
                    } else {
                        exit = Math.min(
                            exit,
                            (deadline - start) / dt,
                        );

                        if (exit < enter || deadline <= start) {
                            continue;
                        }
                    }
                }

                support.push([enter, exit]);
            }
        }

        support.sort((a, b) => a[0] - b[0]);

        let covered = 0;

        for (const [enter, exit] of support) {
            if (enter > covered + 1e-9) {
                break;
            }

            covered = Math.max(covered, exit);

            if (covered >= 1 - 1e-10) {
                break;
            }
        }

        const gap =
            covered >= 1 - 1e-10 ? Infinity : covered;

        const hit = this.findMountainHit(from, to, ballRadius);
        const event = Math.min(gap, hit);

        const fraction = Number.isFinite(event)
            ? Math.max(0, Math.min(1, event))
            : 1;

        for (const trigger of pending) {
            if (
                trigger.enter <= fraction + 1e-9 &&
                !this.glassDeadlines.has(trigger.id)
            ) {
                this.glassDeadlines.set(
                    trigger.id,
                    trigger.deadline,
                );
            }
        }

        const elapsed = dt * fraction;
        this.advanceGlassTime(elapsed);

        return {
            fraction,
            kind: !Number.isFinite(event)
                ? 'none'
                : hit <= gap ? 'mountain' : 'gap',
            elapsed,
        };
    }

    private rectangleInterval(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        centerX: number,
        centerZ: number,
        half: number,
    ): [number, number] | null {
        let enter = 0;
        let exit = 1;

        const axes = [
            [from.x, to.x - from.x, centerX - half, centerX + half],
            [from.z, to.z - from.z, centerZ - half, centerZ + half],
        ];

        for (const [origin, delta, min, max] of axes) {
            if (Math.abs(delta) < 1e-12) {
                if (origin < min || origin > max) {
                    return null;
                }

                continue;
            }

            let a = (min - origin) / delta;
            let b = (max - origin) / delta;

            if (a > b) {
                [a, b] = [b, a];
            }

            enter = Math.max(enter, a);
            exit = Math.min(exit, b);

            if (enter > exit) {
                return null;
            }
        }

        return [enter, exit];
    }

    private segmentDistanceSquared(
        x: number,
        y: number,
        ax: number,
        ay: number,
        bx: number,
        by: number,
    ): number {
        const dx = bx - ax;
        const dy = by - ay;
        const length2 = dx * dx + dy * dy;

        const t = length2 <= 1e-20
            ? 0
            : Math.max(
                0,
                Math.min(
                    1,
                    ((x - ax) * dx + (y - ay) * dy) / length2,
                ),
            );

        const ex = x - ax - t * dx;
        const ey = y - ay - t * dy;

        return ex * ex + ey * ey;
    }

    private coneDistanceSquared(
        x: number,
        y: number,
        z: number,
        radius: number,
        height: number,
    ): number {
        const radial = Math.hypot(x, z);

        if (
            y >= 0 &&
            y <= height &&
            radial <= radius * (1 - y / height)
        ) {
            return 0;
        }

        return Math.min(
            this.segmentDistanceSquared(
                radial, y, 0, 0, radius, 0,
            ),
            this.segmentDistanceSquared(
                radial, y, radius, 0, 0, height,
            ),
            this.segmentDistanceSquared(
                radial, y, 0, height, 0, 0,
            ),
        );
    }

    public findMountainHit(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        ballRadius: number,
    ): number {
        const r = Math.max(0.01, this.mountainHitRadius);
        const h = Math.max(0.01, this.mountainHeight);
        const ball = Math.max(0, ballRadius);
        const range = r + ball;

        const first = Math.max(
            0,
            Math.ceil(
                (-Math.max(from.z, to.z) - range) / this.tileSize,
            ),
        );

        const last = Math.min(
            this.mapRows.length - 1,
            Math.floor(
                (-Math.min(from.z, to.z) + range) / this.tileSize,
            ),
        );

        let firstHit = Infinity;

        for (let row = first; row <= last; row++) {
            for (let col = 0; col < this.columns; col++) {
                const id = row * this.columns + col;

                if (!this.mountains.has(id)) {
                    continue;
                }

                const baseY = this.mountainBaseY(row, col);

                if (baseY === null) {
                    continue;
                }

                const cx = (col - 2) * this.tileSize;
                const cz = -row * this.tileSize;

                if (
                    Math.min(from.x, to.x) > cx + range ||
                    Math.max(from.x, to.x) < cx - range ||
                    Math.min(from.y, to.y) > baseY + h + ball ||
                    Math.max(from.y, to.y) < baseY - ball
                ) {
                    continue;
                }

                const distance = (t: number): number => {
                    return this.coneDistanceSquared(
                        from.x + (to.x - from.x) * t - cx,
                        from.y + (to.y - from.y) * t - baseY,
                        from.z + (to.z - from.z) * t - cz,
                        r,
                        h,
                    );
                };

                const limit = ball * ball + 1e-10;

                if (distance(0) <= limit) {
                    return 0;
                }

                let lo = 0;
                let hi = 1;

                for (let i = 0; i < 48; i++) {
                    const a = lo + (hi - lo) / 3;
                    const b = hi - (hi - lo) / 3;

                    if (distance(a) <= distance(b)) {
                        hi = b;
                    } else {
                        lo = a;
                    }
                }

                let nearest = (lo + hi) / 2;

                if (distance(1) < distance(nearest)) {
                    nearest = 1;
                }

                if (distance(nearest) > limit) {
                    continue;
                }

                lo = 0;
                hi = nearest;

                for (let i = 0; i < 40; i++) {
                    const mid = (lo + hi) / 2;

                    if (distance(mid) <= limit) {
                        hi = mid;
                    } else {
                        lo = mid;
                    }
                }

                firstHit = Math.min(firstHit, hi);
            }
        }

        return firstHit;
    }

    private createCollectibles() {
        for (const item of this.collectibles) {
            const prefab = item.kind === 'diamond'
                ? this.diamondPrefab
                : this.crownPrefab;

            if (!prefab) {
                continue;
            }

            const instance = instantiate(prefab);
            instance.parent = this.node;

            // 当前预制体的 Visual 位于局部 Y=1.2。
            // 默认高度下，预制体根节点位于地面 Y=0。
            instance.setPosition(
                item.x,
                item.y - 1.2,
                item.z,
            );

            item.view = instance;
        }

        this.refreshCollectibles();
    }

    private refreshCollectibles() {
        for (const item of this.collectibles) {
            if (item.view) {
                item.view.active =
                    !item.collected && this.isRowVisible(item.row);
            }
        }
    }

    // 检测球心移动线段与收集球形范围的首次接触。
    // fatal=true：路径终点是死亡位置，不允许死亡同刻拾取。
    public collectAlongPath(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        ballRadius: number,
        fatal: boolean = false,
    ) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const a = dx * dx + dy * dy + dz * dz;

        for (const item of this.collectibles) {
            if (item.collected) {
                continue;
            }

            const itemRadius = item.kind === 'diamond'
                ? this.diamondPickupRadius
                : this.crownPickupRadius;

            const radius =
                Math.max(0, ballRadius) +
                Math.max(0, itemRadius);

            const ox = from.x - item.x;
            const oy = from.y - item.y;
            const oz = from.z - item.z;

            const c =
                ox * ox + oy * oy + oz * oz -
                radius * radius;

            let enter = Infinity;

            if (c <= 0) {
                enter = 0;
            } else if (a > 1e-20) {
                const b = ox * dx + oy * dy + oz * dz;
                const discriminant = b * b - a * c;

                if (discriminant >= 0) {
                    enter =
                        (-b - Math.sqrt(discriminant)) / a;
                }
            }

            if (enter < 0 || enter > 1) {
                continue;
            }

            if (
                fatal &&
                (a <= 1e-20 || enter >= 1 - 1e-9)
            ) {
                continue;
            }

            item.collected = true;

            if (item.view) {
                item.view.active = false;
            }
        }
    }

    lateUpdate() {
        if (!this.initialized) {
            return;
        }

        this.updateRoad();
        this.refreshViews();
        this.refreshCollectibles();
    }
}