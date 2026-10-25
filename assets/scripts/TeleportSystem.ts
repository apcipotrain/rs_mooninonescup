import {
    _decorator,
    Component,
    Node,
    Prefab,
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

interface TeleportMap {
    columns: number;
    tileSize: number;
    rowCount: number;
    defaultGround?: string;
    segments: Segment[];
    teleports?: GridPoint[];
}

export interface TeleportEntry extends GridPoint {
    id: number;
    exitRow: number;
    fraction: number;
}

@ccclass('TeleportSystem')
export class TeleportSystem extends Component {
    @property(RoadGenerator)
    road: RoadGenerator | null = null;

    @property(Prefab)
    teleportPrefab: Prefab | null = null;

    // 固定前进 8 个行距。
    private readonly travelRows = 8;

    private tileSize = 2;
    private entries: GridPoint[] = [];
    private instances: Node[] = [];
    private loaded = false;

    public getTileSize(): number {
        return this.tileSize;
    }

    // 第一次使用时加载，不依赖 onLoad 的执行顺序。
    public ensureLoaded(): boolean {
        if (this.loaded) {
            return true;
        }

        try {
            const config =
                this.road?.levelData?.json as
                TeleportMap | undefined;

            if (!config) {
                throw new Error(
                    '请绑定 Road，并在 Road 中绑定 Level Data',
                );
            }

            if (
                config.columns !== 5 ||
                !Number.isFinite(config.tileSize) ||
                config.tileSize <= 0 ||
                !Number.isInteger(config.rowCount) ||
                config.rowCount <= 0 ||
                !Array.isArray(config.segments)
            ) {
                throw new Error(
                    '地图 columns、tileSize、rowCount ' +
                    '或 segments 不正确',
                );
            }

            const points = config.teleports ?? [];

            if (!Array.isArray(points)) {
                throw new Error('teleports 必须是数组');
            }

            // 查询指定行的地板，支持现有 repeat 配置。
            const groundAt = (row: number): string => {
                let line =
                    config.defaultGround ?? '11111';

                for (const segment of config.segments) {
                    const length = segment.ground.length;
                    const offset = row - segment.startRow;

                    if (
                        length > 0 &&
                        offset >= 0 &&
                        offset <
                        length * (segment.repeat ?? 1)
                    ) {
                        line =
                            segment.ground[offset % length];
                    }
                }

                return line;
            };

            const seen = new Set<number>();
            const entries: GridPoint[] = [];

            for (const point of points) {
                if (
                    !point ||
                    !Number.isInteger(point.row) ||
                    !Number.isInteger(point.col) ||
                    point.row < 0 ||
                    point.col < 0 ||
                    point.col >= 5 ||
                    point.row + this.travelRows >=
                    config.rowCount
                ) {
                    throw new Error(
                        '传送坐标无效，或出口超过地图范围',
                    );
                }

                const id = point.row * 5 + point.col;

                if (seen.has(id)) {
                    throw new Error(
                        `传送入口重复：${point.row},${point.col}`,
                    );
                }

                const entryGround =
                    groundAt(point.row)[point.col];

		if (!['1', '3', '5'].includes(entryGround)) {
		    throw new Error(
		        `传送入口 ${point.row},${point.col} 下方没有地板`,
		    );
		}

		// 出口允许为空，作为关卡陷阱。
		// 传送结束后，由 PlayerController 检查地面并触发掉落。

                seen.add(id);

                entries.push({
                    row: point.row,
                    col: point.col,
                });
            }

            if (entries.length && !this.teleportPrefab) {
                throw new Error(
                    '地图含传送入口，请绑定 Teleport Prefab',
                );
            }

            this.tileSize = config.tileSize;
            this.entries = entries;
            this.loaded = true;

            return true;
        } catch (error) {
            console.error(
                'TeleportSystem 配置错误：',
                error,
            );

            return false;
        }
    }

    start() {
    if (!this.ensureLoaded()) {
        return;
    }

    for (const point of this.entries) {
        const instance =
            instantiate(this.teleportPrefab!);
        instance.getComponent(PropArt)?.ensureBuilt();

        instance.parent = this.road!.node;

        instance.setPosition(
            (point.col - 2) * this.tileSize,
            0,
            -point.row * this.tileSize,
        );

        this.instances.push(instance);
    }

    this.refreshVisibility();
}

    // 经过入口所在行的中心线时触发。
    public findEntry(
        from: Readonly<Vec3>,
        to: Readonly<Vec3>,
        ignoredId: number,
    ): TeleportEntry | null {
        const dz = to.z - from.z;

        if (dz >= -1e-12) {
            return null;
        }

        let best: TeleportEntry | null = null;

        for (const point of this.entries) {
            const id = point.row * 5 + point.col;

            if (id === ignoredId) {
                continue;
            }

            const raw =
                (
                    -point.row * this.tileSize -
                    from.z
                ) / dz;

            if (raw < -1e-9 || raw > 1 + 1e-9) {
                continue;
            }

            const fraction =
                Math.max(0, Math.min(1, raw));

            const x =
                from.x +
                (to.x - from.x) * fraction;

            const centerX =
                (point.col - 2) * this.tileSize;

            if (
                Math.abs(x - centerX) >
                this.tileSize / 2 + 1e-9
            ) {
                continue;
            }

            if (!best || fraction < best.fraction) {
                best = {
                    ...point,
                    id,
                    exitRow:
                        point.row + this.travelRows,
                    fraction,
                };
            }
        }

        return best;
    }

private refreshVisibility() {
    if (!this.road) {
        return;
    }

    this.instances.forEach((instance, index) => {
        instance.active = this.road!.isRowVisible(
            this.entries[index].row,
        );
    });
}

lateUpdate() {
    this.refreshVisibility();
}

    onDestroy() {
        for (const instance of this.instances) {
            instance.destroy();
        }

        this.instances = [];
    }
}
