import {
    _decorator,
    Component,
    Node,
    Canvas,
    AudioSource,
    Label,
    Button,
    UITransform,
    Graphics,
    Color,
    Layers,
    Widget,
    BlockInputEvents,
    EventMouse,
    game,
    Game,
} from 'cc';

import { PlayerController } from './PlayerController';

const { ccclass, property } = _decorator;

type GameState =
    | 'ready'
    | 'running'
    | 'paused'
    | 'countdown'
    | 'falling'
    | 'failed'
    | 'finished';

@ccclass('GameManager')
export class GameManager extends Component {
    @property(PlayerController)
    player: PlayerController | null = null;

    @property(Canvas)
    uiCanvas: Canvas | null = null;

    @property(AudioSource)
    bgm: AudioSource | null = null;

    // 保留原属性；运行时以地图统计为准。
    @property
    totalCrowns: number = 0;

    @property
    totalDiamonds: number = 0;

    public collectedCrowns: number = 0;
    public collectedDiamonds: number = 0;

    private state: GameState = 'ready';
    private initialized = false;
    private startZ = 0;
    private progress = 0;
    private countdownStart = 0;

    private readyHint!: Node;
    private pauseButton!: Node;
    private progressHUD!: Node;
    private progressText!: Label;
    private progressBar!: Graphics;
    private collectibleText!: Label;

    private panel!: Node;
    private panelGraphics!: Graphics;
    private title!: Label;
    private continueButton!: Node;
    private restartButton!: Node;
    private resultInfo!: Label;
    private resultBar!: Graphics;

    private panelWidth = -1;
    private panelHeight = -1;
    private lastHUDValue = -1;
    private lastHUDText = '';

    onLoad() {
        if (!this.player || !this.uiCanvas || !this.bgm) {
            console.error(
                'GameManager：请绑定 Player、Ui Canvas 和 Bgm',
            );

            this.enabled = false;
            return;
        }

        this.bgm.playOnAwake = false;

        this.buildUI();
        this.bindEvents();

        this.initialized = true;
        this.restartGame();
    }

    start() {
        // 所有节点 onLoad 完成后，再同步一次地图总数。
        if (this.initialized) {
            this.refreshProgressHUD();
        }
    }

    private syncCollectibles() {
        const stats =
            this.player?.road?.getCollectibleStats();

        if (!stats) {
            return;
        }

        this.totalCrowns = stats.totalCrowns;
        this.totalDiamonds = stats.totalDiamonds;
        this.collectedCrowns = stats.collectedCrowns;
        this.collectedDiamonds = stats.collectedDiamonds;
    }

    private bindEvents() {
        const node = this.player!.node;

        node.on('request-start', this.startGame, this);
        node.on('request-pause', this.pauseGame, this);
        node.on('player-falling', this.onFalling, this);
        node.on('player-failed', this.onFailed, this);
        node.on('player-finished', this.onFinished, this);

        this.player!.isPointerOverUI = (event: EventMouse) => {
            return (
                this.pauseButton.activeInHierarchy &&
                this.pauseButton
                    .getComponent(UITransform)!
                    .hitTest(event.getLocation())
            );
        };

        game.on(Game.EVENT_HIDE, this.onHide, this);
    }

    onDestroy() {
        if (!this.initialized) {
            return;
        }

        if (this.player) {
            const node = this.player.node;

            node.off('request-start', this.startGame, this);
            node.off('request-pause', this.pauseGame, this);
            node.off('player-falling', this.onFalling, this);
            node.off('player-failed', this.onFailed, this);
            node.off('player-finished', this.onFinished, this);

            this.player.isPointerOverUI = null;
        }

        game.off(Game.EVENT_HIDE, this.onHide, this);
    }

    private createUI(
        parent: Node,
        name: string,
        width: number,
        height: number,
    ): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.parent = parent;

        node.addComponent(UITransform).setContentSize(
            width,
            height,
        );

        return node;
    }

    private createLabel(
        parent: Node,
        name: string,
        text: string,
        fontSize: number,
        y: number,
        width: number = 900,
        height: number = 120,
    ): Label {
        const node = this.createUI(
            parent,
            name,
            width,
            height,
        );

        node.setPosition(0, y, 0);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 12;
        label.color = Color.WHITE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;

        return label;
    }

    private createButton(
        parent: Node,
        name: string,
        text: string,
        y: number,
        callback: () => void,
        width: number = 280,
        height: number = 80,
    ): Node {
        const node = this.createUI(
            parent,
            name,
            width,
            height,
        );

        node.setPosition(0, y, 0);

        const graphics = node.addComponent(Graphics);
        graphics.fillColor = new Color(45, 65, 90, 255);

        graphics.roundRect(
            -width / 2,
            -height / 2,
            width,
            height,
            12,
        );

        graphics.fill();

        const button = node.addComponent(Button);
        button.transition = Button.Transition.NONE;

        node.on(Button.EventType.CLICK, callback, this);

        this.createLabel(
            node,
            'Label',
            text,
            30,
            0,
            width - 16,
            height - 10,
        );

        return node;
    }

    private createBar(
        parent: Node,
        name: string,
        width: number,
        height: number,
        y: number,
    ): Graphics {
        const node = this.createUI(
            parent,
            name,
            width,
            height,
        );

        node.setPosition(0, y, 0);
        return node.addComponent(Graphics);
    }

    private buildUI() {
        const canvas = this.uiCanvas!.node;

        this.readyHint = this.createLabel(
            canvas,
            'ReadyHint',
            '拖动鼠标或按 A/D、左右方向键开始',
            30,
            90,
        ).node;

        this.pauseButton = this.createButton(
            canvas,
            'PauseButton',
            'Ⅱ',
            0,
            this.pauseGame,
            96,
            64,
        );

        const pauseWidget =
            this.pauseButton.addComponent(Widget);

        pauseWidget.isAlignLeft = true;
        pauseWidget.isAlignTop = true;
        pauseWidget.left = 20;
        pauseWidget.top = 20;
        pauseWidget.alignMode = Widget.AlignMode.ALWAYS;

        this.progressHUD = this.createUI(
            canvas,
            'ProgressHUD',
            320,
            125,
        );

        const progressWidget =
            this.progressHUD.addComponent(Widget);

        progressWidget.isAlignRight = true;
        progressWidget.isAlignTop = true;
        progressWidget.right = 24;
        progressWidget.top = 20;
        progressWidget.alignMode = Widget.AlignMode.ALWAYS;

        this.progressText = this.createLabel(
            this.progressHUD,
            'ProgressText',
            '0%',
            34,
            16,
            250,
            50,
        );

        this.progressBar = this.createBar(
            this.progressHUD,
            'ProgressBar',
            240,
            10,
            -22,
        );

        this.collectibleText = this.createLabel(
            this.progressHUD,
            'CollectibleText',
            '',
            22,
            -56,
            310,
            40,
        );
	this.collectibleText.node.active = false;

        this.panel = this.createUI(
            canvas,
            'OverlayPanel',
            1280,
            720,
        );

        const panelWidget = this.panel.addComponent(Widget);

        panelWidget.isAlignTop = true;
        panelWidget.isAlignBottom = true;
        panelWidget.isAlignLeft = true;
        panelWidget.isAlignRight = true;

        panelWidget.top = 0;
        panelWidget.bottom = 0;
        panelWidget.left = 0;
        panelWidget.right = 0;
        panelWidget.alignMode = Widget.AlignMode.ALWAYS;

        this.panelGraphics =
            this.panel.addComponent(Graphics);

        this.panel.addComponent(BlockInputEvents);

        this.title = this.createLabel(
            this.panel,
            'Title',
            '已暂停',
            56,
            120,
        );

        this.continueButton = this.createButton(
            this.panel,
            'ContinueButton',
            '继续游戏',
            0,
            this.beginCountdown,
        );

        this.restartButton = this.createButton(
            this.panel,
            'RestartButton',
            '重新开始',
            -110,
            this.restartGame,
        );

        this.resultInfo = this.createLabel(
            this.panel,
            'ResultInfo',
            '',
            32,
            0,
            680,
            120,
        );

        this.resultInfo.lineHeight = 46;

        this.resultBar = this.createBar(
            this.panel,
            'ResultProgressBar',
            420,
            14,
            -85,
        );
    }

    private startGame() {
        if (this.state !== 'ready') {
            return;
        }

        this.state = 'running';
        this.readyHint.active = false;
        this.pauseButton.active = true;
        this.progressHUD.active = true;

        this.player!.startRunning();

        this.bgm!.stop();
        this.bgm!.currentTime = 0;
        this.bgm!.play();
    }

    private pauseGame() {
        if (this.state !== 'running') {
            return;
        }

        this.state = 'paused';

        this.player!.freeze();
        this.bgm!.pause();

        this.showMenu('已暂停', true);
    }

    private beginCountdown() {
        if (this.state !== 'paused') {
            return;
        }

        this.state = 'countdown';
        this.countdownStart = performance.now();

        this.continueButton.active = false;
        this.restartButton.active = false;

        this.title.node.setPosition(0, 0, 0);
        this.title.string = '2.0';
    }

    private resumeGame() {
        this.state = 'running';

        this.panel.active = false;
        this.pauseButton.active = true;
        this.progressHUD.active = true;

        this.player!.resumeRunning();
        this.bgm!.play();
    }

    private restartGame() {
        this.state = 'ready';
        this.countdownStart = 0;

        this.bgm!.stop();
        this.bgm!.currentTime = 0;

        this.player!.resetToReady();

        this.startZ = this.player!.node.position.z;
        this.progress = 0;
        this.collectedCrowns = 0;
        this.collectedDiamonds = 0;

        this.panel.active = false;
        this.pauseButton.active = false;
        this.readyHint.active = true;
        this.progressHUD.active = true;

        this.resultInfo.node.active = false;
        this.resultBar.node.active = false;

        this.refreshProgressHUD();
    }

    private onHide() {
        if (this.state === 'running') {
            this.pauseGame();
        } else if (this.state === 'countdown') {
            this.state = 'paused';
            this.showMenu('已暂停', true);
        }
    }

    private onFalling() {
        this.refreshProgress();
        this.state = 'falling';

        this.pauseButton.active = false;
        this.bgm!.stop();

        this.refreshProgressHUD();
    }

    private onFailed() {
        this.state = 'failed';
        this.showResult('游戏失败');
    }

    private onFinished() {
        this.state = 'finished';
        this.progress = 1;

        this.bgm!.stop();
        this.showResult('关卡完成');
    }

    private showMenu(title: string, canContinue: boolean) {
        this.readyHint.active = false;
        this.pauseButton.active = false;
        this.progressHUD.active = false;
        this.panel.active = true;

        this.title.node.setPosition(0, 120, 0);
        this.title.string = title;

        this.continueButton.active = canContinue;
        this.restartButton.active = true;
        this.restartButton.setPosition(0, -110, 0);

        this.resultInfo.node.active = false;
        this.resultBar.node.active = false;

        this.refreshPanelBackground();
    }

    private showResult(title: string) {
        this.refreshProgress();

        if (this.state === 'finished') {
            this.progress = 1;
        }

        this.showMenu(title, false);
        this.syncCollectibles();

        this.resultInfo.string =
            `进度 ${this.getProgressPercent()}%\n` +
            `皇冠 ${this.collectedCrowns}/${this.totalCrowns}` +
            `     钻石 ${this.collectedDiamonds}/${this.totalDiamonds}`;

        this.resultInfo.node.active = true;
        this.resultBar.node.active = true;

        this.drawProgressBar(
            this.resultBar,
            420,
            14,
            this.progress,
        );

        this.restartButton.setPosition(0, -160, 0);
    }

    private refreshProgress() {
        const totalDistance =
            this.startZ - this.player!.finishZ;

        if (totalDistance <= 0) {
            this.progress = 0;
            return;
        }

        const travelled =
            this.startZ - this.player!.node.position.z;

        this.progress = Math.max(
            0,
            Math.min(1, travelled / totalDistance),
        );
    }

    private getProgressPercent(): number {
        if (this.state === 'finished') {
            return 100;
        }

        return Math.min(
            99,
            Math.floor(this.progress * 100),
        );
    }

    private refreshProgressHUD() {
        this.syncCollectibles();

        const collectedText =
            `皇冠 ${this.collectedCrowns}/${this.totalCrowns}    ` +
            `钻石 ${this.collectedDiamonds}/${this.totalDiamonds}`;

        if (this.collectibleText.string !== collectedText) {
            this.collectibleText.string = collectedText;
        }

        const text = `${this.getProgressPercent()}%`;

        if (text !== this.lastHUDText) {
            this.progressText.string = text;
            this.lastHUDText = text;
        }

        const barValue = Math.floor(this.progress * 1000);

        if (barValue !== this.lastHUDValue) {
            this.drawProgressBar(
                this.progressBar,
                240,
                10,
                barValue / 1000,
            );

            this.lastHUDValue = barValue;
        }
    }

    private drawProgressBar(
        graphics: Graphics,
        width: number,
        height: number,
        value: number,
    ) {
        const ratio = Math.max(0, Math.min(1, value));

        graphics.clear();
        graphics.fillColor = new Color(50, 60, 75, 230);

        graphics.roundRect(
            -width / 2,
            -height / 2,
            width,
            height,
            height / 2,
        );

        graphics.fill();

        const fillWidth = width * ratio;

        if (fillWidth <= 0) {
            return;
        }

        graphics.fillColor = new Color(150, 230, 240, 255);

        graphics.roundRect(
            -width / 2,
            -height / 2,
            fillWidth,
            height,
            Math.min(height / 2, fillWidth / 2),
        );

        graphics.fill();
    }

    private refreshPanelBackground() {
        if (!this.panel.activeInHierarchy) {
            return;
        }

        this.panel.getComponent(Widget)!.updateAlignment();

        const size =
            this.panel.getComponent(UITransform)!.contentSize;

        if (
            size.width === this.panelWidth &&
            size.height === this.panelHeight
        ) {
            return;
        }

        this.panelWidth = size.width;
        this.panelHeight = size.height;

        this.panelGraphics.clear();
        this.panelGraphics.fillColor =
            new Color(0, 0, 0, 155);

        this.panelGraphics.rect(
            -size.width / 2,
            -size.height / 2,
            size.width,
            size.height,
        );

        this.panelGraphics.fill();
    }

    update() {
        if (!this.initialized) {
            return;
        }

        this.refreshPanelBackground();

        if (this.state !== 'countdown') {
            return;
        }

        const elapsed =
            (performance.now() - this.countdownStart) / 1000;

        const remaining = 2 - elapsed;

        if (remaining <= 0) {
            this.resumeGame();
            return;
        }

        const display = Math.min(
            2,
            Math.max(
                0.1,
                Math.ceil(remaining * 10) / 10,
            ),
        );

        this.title.string = display.toFixed(1);
    }

    lateUpdate() {
        if (!this.initialized) {
            return;
        }

        if (this.state === 'running') {
            this.refreshProgress();
            this.refreshProgressHUD();
        }
    }
}