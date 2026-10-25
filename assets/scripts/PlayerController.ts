import {
    _decorator,
    Component,
    MeshRenderer,
    Vec3,
    input,
    Input,
    EventKeyboard,
    EventMouse,
    KeyCode,
    game,
    Game,
} from 'cc';

import { RoadGenerator } from './RoadGenerator';
import {
    TeleportSystem,
    TeleportEntry,
} from './TeleportSystem';
import { LaserSystem } from './LaserSystem';

const { ccclass, property } = _decorator;

type PlayerMode =
    | 'ready'
    | 'running'
    | 'locked'
    | 'falling';

@ccclass('PlayerController')
export class PlayerController extends Component {
    @property(RoadGenerator)
    road: RoadGenerator | null = null;

    @property(TeleportSystem)
    teleportSystem: TeleportSystem | null = null;

    @property(LaserSystem)
    laserSystem: LaserSystem | null = null;

    @property
    forwardSpeed: number = 6;

    @property
    horizontalSpeed: number = 6;

    @property
    mouseSensitivity: number = 0.02;

    @property
    finishZ: number = -726;

    @property
    ballRadius: number = 0.8;

    @property
    fallGravity: number = 20;

    @property
    jumpClearRows: number = 3;

    @property
    jumpHeight: number = 4;

    public mode: PlayerMode = 'ready';

    public isPointerOverUI:
        ((event: EventMouse) => boolean) | null = null;

    private keys = new Set<KeyCode>();
    private entryBlocked = false;
    private entryHeldKeys = new Set<KeyCode>();

    public setEntryBlocked(blocked: boolean) {
        this.entryBlocked = blocked;
        this.clearInput();
    }

    private dragging = false;
    private mouseStartX = 0;
    private playerStartX = 0;
    private mouseTargetX = 0;
    private lastMouseX = 0;

    private crashed = false;
    private fallSpeed = 0;
    private fallTime = 0;

    private jumping = false;
    private jumpTime = 0;
    private jumpDuration = 1;
    private activeJumpHeight = 4;
    private lastJumpRow = -1;

    private teleporting = false;
    private teleportExitZ = 0;
    private teleportX = 0;
    private lastTeleportId = -1;

    private readonly from = new Vec3();
    private readonly target = new Vec3();

    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);

        game.on(Game.EVENT_HIDE, this.onHide, this);
    }

    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);

        game.off(Game.EVENT_HIDE, this.onHide, this);
        this.clearInput();
    }

    public resetToReady() {
        this.clearInput();

        this.crashed = false;
        this.fallSpeed = 0;
        this.fallTime = 0;

        this.jumping = false;
        this.jumpTime = 0;
        this.lastJumpRow = -1;

        this.teleporting = false;
        this.lastTeleportId = -1;

        this.setBallVisible(true);
        this.node.setPosition(0, this.ballRadius, 0);

        this.mouseTargetX = 0;
        this.mode = 'ready';

        this.road?.resetGlass();
        this.road?.resetCollectibles();
        this.laserSystem?.reset();
    }

    public startRunning() {
        this.mode = 'running';
    }

    public freeze() {
        this.mode = 'locked';
        this.clearInput();
    }

    public resumeRunning() {
        this.clearInput();
        this.mode = 'running';
    }

    private clearInput() {
        this.keys.clear();
        this.dragging = false;
    }

    private onHide() {
        this.clearInput();
        this.node.emit('request-pause');
    }

    private isDirectionKey(code: KeyCode): boolean {
        return (
            code === KeyCode.KEY_A ||
            code === KeyCode.KEY_D ||
            code === KeyCode.ARROW_LEFT ||
            code === KeyCode.ARROW_RIGHT
        );
    }

    private onKeyDown(event: EventKeyboard) {
        if (!this.isDirectionKey(event.keyCode)) {
            return;
        }

        if (this.entryBlocked) {
            this.entryHeldKeys.add(event.keyCode);
            return;
        }
        // Holding a direction on the cover must not start the level via OS key repeat.
        if (this.entryHeldKeys.has(event.keyCode)) return;

        if (this.mode === 'ready') {
            this.node.emit('request-start');
        }

        if (this.mode === 'running') {
            this.keys.add(event.keyCode);
        }
    }

    private onKeyUp(event: EventKeyboard) {
        this.keys.delete(event.keyCode);
        this.entryHeldKeys.delete(event.keyCode);
    }

    private onMouseDown(event: EventMouse) {
        if (
            this.entryBlocked ||
            event.getButton() !== EventMouse.BUTTON_LEFT ||
            (
                this.mode !== 'ready' &&
                this.mode !== 'running'
            ) ||
            this.isPointerOverUI?.(event)
        ) {
            return;
        }

        this.dragging = true;
        this.lastMouseX = event.getLocationX();
        this.mouseStartX = this.lastMouseX;
        this.playerStartX = this.node.position.x;
        this.mouseTargetX = this.playerStartX;
    }

    private onMouseMove(event: EventMouse) {
        if (this.entryBlocked) return;
        this.lastMouseX = event.getLocationX();

        if (this.teleporting) {
            this.reanchorMouse();
            return;
        }

        if (!this.dragging) {
            return;
        }

        const delta = this.lastMouseX - this.mouseStartX;

        if (this.mode === 'ready') {
            if (Math.abs(delta) < 4) {
                return;
            }

            this.node.emit('request-start');
        }

        if (this.mode === 'running') {
            this.mouseTargetX =
                this.playerStartX +
                delta * this.mouseSensitivity;
        }
    }

    private onMouseUp(event: EventMouse) {
        if (this.entryBlocked) { this.dragging = false; return; }
        if (event.getButton() !== EventMouse.BUTTON_LEFT) {
            return;
        }

        this.lastMouseX = event.getLocationX();

        if (this.teleporting) {
            this.dragging = false;
            return;
        }

        if (this.dragging && this.mode === 'running') {
            this.mouseTargetX =
                this.playerStartX +
                (this.lastMouseX - this.mouseStartX) *
                    this.mouseSensitivity;

            this.moveInstantly(this.mouseTargetX);
        }

        this.dragging = false;
    }

    private moveInstantly(x: number) {
        if (!this.road || this.teleporting) {
            return;
        }

        const p = this.node.position;
        this.from.set(p.x, p.y, p.z);
        this.target.set(x, p.y, p.z);

        if (this.jumping) {
            this.moveAirSegment(0);
            return;
        }

        const jump = this.road.findJumpCrossing(
            this.from,
            this.target,
            this.lastJumpRow,
        );

        if (!jump) {
            this.moveGroundSegment(0);
            return;
        }

        this.target.set(
            this.from.x + (x - this.from.x) * jump.fraction,
            p.y,
            p.z,
        );

        this.moveGroundSegment(0);

        if (!this.isRunning()) {
            return;
        }

        this.startJump(jump.row);

        const takeoff = this.node.position;

        this.from.set(takeoff.x, takeoff.y, takeoff.z);
        this.target.set(x, takeoff.y, takeoff.z);
        this.moveAirSegment(0);
    }

    private placeBetween(fraction: number) {
        this.node.setPosition(
            this.from.x +
                (this.target.x - this.from.x) * fraction,
            this.from.y +
                (this.target.y - this.from.y) * fraction,
            this.from.z +
                (this.target.z - this.from.z) * fraction,
        );
    }

    private moveGroundSegment(dt: number): number {
        if (!this.road) {
            return dt;
        }

        const laserHit =
            this.laserSystem?.findHit(
                this.from,
                this.target,
                dt,
                this.ballRadius,
            ) ?? Infinity;

        const clip = Number.isFinite(laserHit)
            ? laserHit
            : 1;

        this.target.set(
            this.from.x +
                (this.target.x - this.from.x) * clip,
            this.from.y +
                (this.target.y - this.from.y) * clip,
            this.from.z +
                (this.target.z - this.from.z) * clip,
        );

        const result = this.road.traceMovement(
            this.from,
            this.target,
            dt * clip,
            this.ballRadius,
        );

        this.placeBetween(result.fraction);

        this.laserSystem?.advance(
            this.from,
            this.node.position,
            result.elapsed,
        );

        // 只拾取实际走到的位置之前接触的物品。
        this.road.collectAlongPath(
            this.from,
            this.node.position,
            this.ballRadius,
            result.kind !== 'none' || Number.isFinite(laserHit),
        );

        if (result.kind !== 'none') {
            this.beginDeath(result.kind === 'mountain');
        } else if (Number.isFinite(laserHit)) {
            this.beginDeath(true);
        }

        return result.elapsed;
    }

    private moveAirSegment(dt: number): number {
        if (!this.road) {
            return dt;
        }

        const mountain = this.road.findMountainHit(
            this.from,
            this.target,
            this.ballRadius,
        );

        const laser =
            this.laserSystem?.findHit(
                this.from,
                this.target,
                dt,
                this.ballRadius,
            ) ?? Infinity;

        const hit = Math.min(mountain, laser);
        const fraction = Number.isFinite(hit) ? hit : 1;
        const used = dt * fraction;

        this.placeBetween(fraction);
        this.road.advanceGlassTime(used);

        this.laserSystem?.advance(
            this.from,
            this.node.position,
            used,
        );

        this.road.collectAlongPath(
            this.from,
            this.node.position,
            this.ballRadius,
            Number.isFinite(hit),
        );

        if (Number.isFinite(hit)) {
            this.beginDeath(true);
        }

        return used;
    }

    private checkGroundPoint() {
        const p = this.node.position;

        this.from.set(p.x, p.y, p.z);
        this.target.set(p.x, p.y, p.z);
        this.moveGroundSegment(0);
    }

    private startJump(row: number) {
        if (!this.road) {
            return;
        }

        this.jumping = true;
        this.jumpTime = 0;
        this.lastJumpRow = row;

        const landingRow =
            row +
            Math.max(0, Math.floor(this.jumpClearRows)) +
            1;

        const landingZ =
            -landingRow * this.road.getTileSize();

        const distance = Math.max(
            0.01,
            this.node.position.z - landingZ,
        );

        this.jumpDuration =
            distance / Math.max(0.001, this.forwardSpeed);

        this.activeJumpHeight =
            Math.max(0.01, this.jumpHeight);
    }

    private jumpY(time: number): number {
        const t = Math.max(
            0,
            Math.min(1, time / this.jumpDuration),
        );

        return (
            this.ballRadius +
            4 * this.activeJumpHeight * t * (1 - t)
        );
    }

    private stepGround(
        dt: number,
        velocityX: number,
    ): number {
        if (!this.road) {
            return dt;
        }

        const p = this.node.position;
        this.from.set(p.x, this.ballRadius, p.z);

        this.target.set(
            p.x + velocityX * dt,
            this.ballRadius,
            Math.max(
                this.finishZ,
                p.z - this.forwardSpeed * dt,
            ),
        );

        const jump = this.road.findJumpCrossing(
            this.from,
            this.target,
            this.lastJumpRow,
        );

        const teleport =
            this.teleportSystem?.findEntry(
                this.from,
                this.target,
                this.lastTeleportId,
            ) ?? null;

        const useTeleport =
            teleport !== null &&
            (
                jump === null ||
                teleport.fraction <= jump.fraction
            );

        const part = useTeleport
            ? teleport!.fraction
            : jump ? jump.fraction : 1;

        this.target.set(
            this.from.x +
                (this.target.x - this.from.x) * part,
            this.ballRadius,
            this.from.z +
                (this.target.z - this.from.z) * part,
        );

        const used = this.moveGroundSegment(dt * part);

        if (!this.isRunning()) {
            return used;
        }

        if (useTeleport) {
            this.startTeleport(teleport!);
        } else if (jump) {
            this.startJump(jump.row);
        }

        return used;
    }

    private stepAir(
        dt: number,
        velocityX: number,
    ): number {
        if (!this.road) {
            return dt;
        }

        const used = Math.min(
            dt,
            this.jumpDuration - this.jumpTime,
        );

        const p = this.node.position;
        this.from.set(p.x, p.y, p.z);

        this.target.set(
            p.x + velocityX * used,
            this.jumpY(this.jumpTime + used),
            Math.max(
                this.finishZ,
                p.z - this.forwardSpeed * used,
            ),
        );

        const consumed = this.moveAirSegment(used);
        this.jumpTime += consumed;

        if (!this.isRunning()) {
            return consumed;
        }

        if (this.jumpTime >= this.jumpDuration - 1e-9) {
            this.jumping = false;

            const landed = this.node.position;

            this.node.setPosition(
                landed.x,
                this.ballRadius,
                landed.z,
            );

            this.checkGroundPoint();
        }

        return consumed;
    }

    private reanchorMouse() {
        this.mouseStartX = this.lastMouseX;
        this.playerStartX = this.node.position.x;
        this.mouseTargetX = this.playerStartX;
    }

    private startTeleport(entry: TeleportEntry) {
        if (!this.teleportSystem) {
            return;
        }

        const exitZ =
            -entry.exitRow *
            this.teleportSystem.getTileSize();

        if (
            this.forwardSpeed <= 0 ||
            exitZ < this.finishZ - 1e-8
        ) {
            console.error(
                '传送要求 Forward Speed 大于0，' +
                '且出口不能超过 Finish Z',
            );

            this.freeze();
            this.node.emit('request-pause');
            return;
        }

        this.teleporting = true;
        this.jumping = false;
        this.teleportExitZ = exitZ;
        this.teleportX = this.node.position.x;
        this.lastTeleportId = entry.id;

        this.reanchorMouse();
        this.setBallVisible(false);
    }

    private stepTeleport(dt: number): number {
        if (!this.road) {
            return dt;
        }

        const p = this.node.position;
        this.from.set(p.x, p.y, p.z);

        const distance = Math.max(
            0,
            p.z - this.teleportExitZ,
        );

        const used = Math.min(
            dt,
            distance / this.forwardSpeed,
        );

        const arrived =
            distance <= this.forwardSpeed * dt + 1e-9;

        this.node.setPosition(
            this.teleportX,
            this.ballRadius,
            arrived
                ? this.teleportExitZ
                : p.z - this.forwardSpeed * used,
        );

        this.road.advanceGlassTime(used);

        this.laserSystem?.advance(
            this.from,
            this.node.position,
            used,
        );

        // 传送途中不调用拾取检测。
        if (arrived) {
            this.teleporting = false;
            this.setBallVisible(true);
            this.reanchorMouse();

            // 出口恢复地面、障碍和拾取检测。
            this.checkGroundPoint();
        }

        return used;
    }

    private getHorizontalVelocity(dt: number): number {
        if (this.teleporting || dt <= 0) {
            return 0;
        }

        if (this.dragging) {
            return (
                this.mouseTargetX -
                this.node.position.x
            ) / dt;
        }

        const left =
            this.keys.has(KeyCode.KEY_A) ||
            this.keys.has(KeyCode.ARROW_LEFT);

        const right =
            this.keys.has(KeyCode.KEY_D) ||
            this.keys.has(KeyCode.ARROW_RIGHT);

        return (
            Number(right) - Number(left)
        ) * this.horizontalSpeed;
    }

    private setBallVisible(visible: boolean) {
        for (
            const renderer of
            this.node.getComponentsInChildren(MeshRenderer)
        ) {
            renderer.enabled = visible;
        }
    }

    private beginDeath(crashed: boolean) {
        if (this.mode !== 'running') {
            return;
        }

        this.crashed = crashed;
        this.jumping = false;
        this.teleporting = false;

        this.mode = 'falling';
        this.fallSpeed = 0;
        this.fallTime = 0;

        this.clearInput();

        if (crashed) {
            this.setBallVisible(false);
        }

        this.node.emit('player-falling');
    }

    private isRunning(): boolean {
        return this.mode === 'running';
    }

    private isDying(): boolean {
        return this.mode === 'falling';
    }

    private updateDeath(dt: number) {
        this.road?.advanceGlassTime(dt);
        this.laserSystem?.advanceTime(dt);
        this.fallTime += dt;

        if (!this.crashed) {
            const p = this.node.position;

            const distance =
                this.fallSpeed * dt +
                0.5 * this.fallGravity * dt * dt;

            this.fallSpeed += this.fallGravity * dt;

            this.node.setPosition(
                p.x,
                Math.max(-30, p.y - distance),
                p.z,
            );
        }

        if (this.fallTime >= 2) {
            this.mode = 'locked';
            this.node.emit('player-failed');
        }
    }

    update(dt: number) {
        if (this.mode === 'falling') {
            this.updateDeath(dt);
            return;
        }

        if (this.mode !== 'running' || dt <= 0) {
            return;
        }

        if (
            !this.road ||
            !Number.isFinite(this.forwardSpeed) ||
            this.forwardSpeed < 0 ||
            (
                this.teleporting &&
                this.forwardSpeed <= 0
            ) ||
            (
                this.teleportSystem &&
                !this.teleportSystem.ensureLoaded()
            ) ||
            (
                this.laserSystem &&
                !this.laserSystem.ensureLoaded()
            )
        ) {
            console.error(
                '请检查 Road、Forward Speed、传送和激光配置',
            );

            this.freeze();
            this.node.emit('request-pause');
            return;
        }

        let velocityX = this.getHorizontalVelocity(dt);
        let remaining = dt;

        while (remaining > 1e-9 && this.isRunning()) {
            if (this.node.position.z <= this.finishZ) {
                this.freeze();
                this.node.emit('player-finished');
                return;
            }

            const step = Math.min(remaining, 1 / 120);
            const wasJumping = this.jumping;
            const wasTeleporting = this.teleporting;

            const consumed = this.teleporting
                ? this.stepTeleport(step)
                : this.jumping
                    ? this.stepAir(step, velocityX)
                    : this.stepGround(step, velocityX);

            remaining = Math.max(0, remaining - consumed);

            if (this.isDying()) {
                if (remaining > 0) {
                    this.updateDeath(remaining);
                }

                return;
            }

            if (!this.isRunning()) {
                return;
            }

            if (wasTeleporting !== this.teleporting) {
                velocityX =
                    this.getHorizontalVelocity(remaining);
            }

            if (
                consumed <= 1e-12 &&
                wasJumping === this.jumping &&
                wasTeleporting === this.teleporting
            ) {
                break;
            }
        }

        if (
            this.isRunning() &&
            this.node.position.z <= this.finishZ
        ) {
            this.freeze();
            this.node.emit('player-finished');
        }
    }
}
