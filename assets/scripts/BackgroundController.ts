import {
    _decorator,
    Component,
    Node,
    Canvas,
    Sprite,
    SpriteFrame,
    UITransform,
    UIOpacity,
    Graphics,
    Color,
    Layers,
    Widget,
    Material,
    MeshRenderer,
} from 'cc';

import { PlayerController } from './PlayerController';

const { ccclass, property } = _decorator;

@ccclass('BackgroundController')
export class BackgroundController extends Component {
    @property(PlayerController)
    player: PlayerController | null = null;

    // 原来的 UI Canvas，不是 BackgroundCanvas。
    @property(Canvas)
    uiCanvas: Canvas | null = null;

    @property([SpriteFrame])
    backgrounds: SpriteFrame[] = [];

    // 小球实际显示模型上的 MeshRenderer。
    @property(MeshRenderer)
    ballRenderer: MeshRenderer | null = null;

    // 顺序与七张背景一致。
    @property([Material])
    ballMaterials: Material[] = [];

    // 0 表示直接切换，不显示白色过渡。
    @property
    transitionDuration: number = 0;

    private readonly switchTimes = [
        16, 32, 48, 64, 80, 96,
    ];

    private backgroundSprite!: Sprite;
    private backgroundTransform!: UITransform;
    private canvasTransform!: UITransform;

    private flashNode!: Node;
    private flashOpacity!: UIOpacity;
    private flashGraphics!: Graphics;

    private currentIndex = -1;
    private currentBallIndex = -1;

    private backgroundWidth = -1;
    private backgroundHeight = -1;
    private flashWidth = -1;
    private flashHeight = -1;

    onLoad() {
        if (!this.player || !this.uiCanvas) {
            console.error(
                'BackgroundController：请绑定 Player 和 Ui Canvas',
            );
            this.enabled = false;
            return;
        }

        if (
            this.backgrounds.length !== 7 ||
            this.backgrounds.some(frame => !frame)
        ) {
            console.error(
                'BackgroundController：请按顺序绑定全部 7 张背景',
            );
            this.enabled = false;
            return;
        }

        const transform = this.node.getComponent(UITransform);

        if (!transform) {
            console.error(
                'BackgroundController 应挂在 BackgroundCanvas 上',
            );
            this.enabled = false;
            return;
        }

        this.canvasTransform = transform;

        // 未手动绑定时，尝试从 Player 及其子节点查找。
        if (!this.ballRenderer) {
            const renderers =
                this.player.node.getComponentsInChildren(
                    MeshRenderer,
                );

            this.ballRenderer = renderers[0] ?? null;
        }

        if (!this.ballRenderer) {
            console.warn(
                'BackgroundController：未找到小球 MeshRenderer，' +
                '请绑定 Ball Renderer',
            );
        }

        if (
            this.ballMaterials.length !== 7 ||
            this.ballMaterials.some(material => !material)
        ) {
            console.warn(
                'BackgroundController：请按背景顺序绑定全部 ' +
                '7 份 Ball Materials',
            );
        }

        this.createBackground();
        this.createWhiteFlash();

        this.setBackground(0);
        this.flashOpacity.opacity = 0;
    }

    private createBackground() {
        const node = new Node('BackgroundImage');
        node.layer = Layers.Enum.UI_3D;
        node.parent = this.node;
        node.setPosition(0, 0, 0);

        this.backgroundTransform =
            node.addComponent(UITransform);

        this.backgroundSprite = node.addComponent(Sprite);
        this.backgroundSprite.type = Sprite.Type.SIMPLE;
        this.backgroundSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.backgroundSprite.trim = false;
    }

    private createWhiteFlash() {
        const node = new Node('BackgroundWhiteFlash');
        node.layer = Layers.Enum.UI_2D;
        node.parent = this.uiCanvas!.node;
        node.setPosition(0, 0, 0);

        // 位于普通 UI 下方，覆盖 3D 画面。
        node.setSiblingIndex(0);
        node.addComponent(UITransform);

        const widget = node.addComponent(Widget);

        widget.isAlignTop = true;
        widget.isAlignBottom = true;
        widget.isAlignLeft = true;
        widget.isAlignRight = true;

        widget.top = 0;
        widget.bottom = 0;
        widget.left = 0;
        widget.right = 0;

        widget.alignMode = Widget.AlignMode.ALWAYS;

        this.flashGraphics = node.addComponent(Graphics);
        this.flashOpacity = node.addComponent(UIOpacity);
        this.flashNode = node;

        this.fitWhiteFlash();
    }

    private setBackground(index: number) {
        if (index !== this.currentIndex) {
            this.currentIndex = index;

            this.backgroundSprite.spriteFrame =
                this.backgrounds[index];

            this.fitBackground();
        }

        // 背景和小球共用同一个索引。
        this.setBallMaterial(index);
    }

    private setBallMaterial(index: number) {
        if (
            !this.ballRenderer ||
            index === this.currentBallIndex
        ) {
            return;
        }

        const material = this.ballMaterials[index];

        if (!material) {
            return;
        }

        // 替换第 0 个材质槽，不修改材质资源本身。
        this.ballRenderer.setSharedMaterial(material, 0);
        this.currentBallIndex = index;
    }

    private fitBackground() {
        const frame = this.backgroundSprite.spriteFrame;

        if (!frame) {
            return;
        }

        const canvasSize = this.canvasTransform.contentSize;
        const imageSize = frame.originalSize;

        if (
            canvasSize.width <= 0 ||
            canvasSize.height <= 0 ||
            imageSize.width <= 0 ||
            imageSize.height <= 0
        ) {
            return;
        }

        const scale = Math.max(
            canvasSize.width / imageSize.width,
            canvasSize.height / imageSize.height,
        );

        this.backgroundTransform.setContentSize(
            imageSize.width * scale,
            imageSize.height * scale,
        );

        this.backgroundWidth = canvasSize.width;
        this.backgroundHeight = canvasSize.height;
    }

    private fitWhiteFlash() {
        this.flashNode
            .getComponent(Widget)!
            .updateAlignment();

        const size = this.flashNode
            .getComponent(UITransform)!
            .contentSize;

        if (
            size.width === this.flashWidth &&
            size.height === this.flashHeight
        ) {
            return;
        }

        this.flashWidth = size.width;
        this.flashHeight = size.height;

        this.flashGraphics.clear();
        this.flashGraphics.fillColor = Color.WHITE;

        this.flashGraphics.rect(
            -size.width / 2,
            -size.height / 2,
            size.width,
            size.height,
        );

        this.flashGraphics.fill();
    }

    private refreshTransition(elapsed: number) {
        let index = 0;

        for (const time of this.switchTimes) {
            if (elapsed >= time) {
                index++;
            }
        }

        this.setBackground(index);

        const halfDuration =
            Math.max(0, this.transitionDuration) / 2;

        let whiteAmount = 0;

        if (halfDuration > 0) {
            for (const time of this.switchTimes) {
                const distance = Math.abs(elapsed - time);

                if (distance < halfDuration) {
                    const amount =
                        1 - distance / halfDuration;

                    whiteAmount = Math.max(
                        whiteAmount,
                        amount,
                    );
                }
            }
        }

        const smooth =
            whiteAmount * whiteAmount *
            (3 - 2 * whiteAmount);

        this.flashOpacity.opacity =
            Math.round(smooth * 255);
    }

    lateUpdate() {
        if (!this.player || !this.backgroundSprite) {
            return;
        }

        const distance = Math.max(
            0,
            -this.player.node.position.z,
        );

        const speed = this.player.forwardSpeed;
        const elapsed = speed > 0
            ? distance / speed
            : 0;

        this.refreshTransition(elapsed);

        const size = this.canvasTransform.contentSize;

        if (
            size.width !== this.backgroundWidth ||
            size.height !== this.backgroundHeight
        ) {
            this.fitBackground();
        }

        this.fitWhiteFlash();
    }

    onDestroy() {
        // 白色层在另一个 Canvas 下，需要主动清理。
        if (this.flashNode?.isValid) {
            this.flashNode.destroy();
        }
    }
}