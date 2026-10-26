import { _decorator, Component, Node, UITransform, Graphics, Color, Label, Button,
    Layers, Widget, BlockInputEvents } from 'cc';

const { ccclass } = _decorator;

/** Same-canvas entry screen; no extra cameras, scenes, textures or audio sources. */
@ccclass('LevelCover')
export class LevelCover extends Component {
    private card!: Node;
    private wash!: Graphics;
    private lastSize = '';

    public build(enter: () => void) {
        this.node.layer = Layers.Enum.UI_2D;
        this.node.addComponent(UITransform).setContentSize(1280,720);
        const w = this.node.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0;
        w.alignMode = Widget.AlignMode.ALWAYS;
        this.node.addComponent(BlockInputEvents);
        this.wash = this.node.addComponent(Graphics);
        this.card = this.ui(this.node,'MoonLandscape',1080,650);
        const g = this.card.addComponent(Graphics);
        g.fillColor = new Color(15,43,48,244);
        g.roundRect(-540,-325,1080,650,24); g.fill();
        g.strokeColor = new Color(182,154,94,190); g.lineWidth = 1.5;
        g.roundRect(-524,-309,1048,618,18); g.stroke();

        // Moon-white disc and layered blue-green ridgelines leave generous text space.
        g.fillColor = new Color(229,234,209,240);
        g.circle(326,18,68); g.fill();
        this.mountains(g,[[60,-100],[158,20],[220,-34],[300,76],[375,-12],[470,43],[515,-100]],new Color(48,97,102));
        this.mountains(g,[[-515,-100],[-400,36],[-326,-25],[-239,63],[-145,-22],[-72,0],[60,-100]],new Color(38,85,88));
        this.mountains(g,[[-520,-130],[-390,-62],[-310,-105],[-240,-43],[-116,-120],[10,-60],[130,-120],[250,-55],[390,-112],[520,-58],[520,-130]],new Color(46,124,111));
        // A small geometric path, faceted jewel and hollow crown echo the playable props.
        for (let row = 0; row < 4; row++) {
            const y = -124 + row*19, span = 103-row*18;
            for (let col = -1; col <= 1; col++) {
                const x = col*span*0.70;
                this.mountains(g,[[x-span*0.32,y],[x+span*0.32,y],[x+span*0.27,y+13],[x-span*0.27,y+13]],new Color(91+row*12,151+row*8,139+row*8));
            }
        }
        g.fillColor = new Color(230,240,220); g.circle(0,-100,18); g.fill();
        this.mountains(g,[[-99,-42],[-84,-27],[-65,-42],[-82,-72]],new Color(94,214,224));
        this.mountains(g,[[-99,-42],[-84,-27],[-65,-42],[-84,-44]],new Color(172,241,237));
        g.strokeColor = new Color(225,177,85); g.lineWidth = 5;
        g.ellipse(97,-49,23,9); g.stroke();
        g.moveTo(75,-47); g.lineTo(72,-24); g.lineTo(88,-37); g.lineTo(98,-15);
        g.lineTo(108,-37); g.lineTo(124,-24); g.lineTo(120,-47); g.stroke();
        g.fillColor = new Color(221,132,145); g.circle(98,-38,3.5); g.fill();

        this.label('Chapter','山 月 · 壹',18,267,new Color(209,180,116),850,34);
        this.label('Title','Moon in One’s Cup',60,195,new Color(239,241,220),980,90);
        this.label('Subtitle','青山入盏，踏月而行',29,128,new Color(185,216,199),950,55);
        this.label('LevelInfo','02:01 · 10 钻石 · 3 皇冠',22,80,new Color(214,184,123),850,40);
        const button = this.ui(this.card,'EnterLevel',320,76);
        button.setPosition(0,-202,0);
        const bg = button.addComponent(Graphics);
        bg.fillColor = new Color(214,170,89); bg.roundRect(-160,-38,320,76,12); bg.fill();
        bg.strokeColor = new Color(248,224,163); bg.lineWidth = 1;
        bg.roundRect(-152,-30,304,60,8); bg.stroke();
        const b = button.addComponent(Button); b.transition = Button.Transition.SCALE;
        b.zoomScale = 1.035;
        const text = this.ui(button,'Label',292,60).addComponent(Label);
        text.string = '进入关卡'; text.fontSize = 29; text.lineHeight = 38;
        text.color = new Color(29,64,65);
        text.horizontalAlign = Label.HorizontalAlign.CENTER; text.verticalAlign = Label.VerticalAlign.CENTER;
        // GameManager guards the cover state; this button also works after returning here.
        button.on(Button.EventType.CLICK, enter);
        this.label('Instructions','入境后，拖动鼠标或按 A / D、左右方向键启程',18,-270,new Color(163,191,180),960,36);
        this.layout();
    }

    private ui(parent: Node,name: string,width: number,height: number) {
        const n = new Node(name); n.layer = Layers.Enum.UI_2D; n.parent = parent;
        n.addComponent(UITransform).setContentSize(width,height); return n;
    }
    private label(name: string,text: string,size: number,y: number,color: Color,width: number,height: number) {
        const n = this.ui(this.card,name,width,height); n.setPosition(0,y,0);
        const l = n.addComponent(Label); l.string = text; l.fontSize = size; l.lineHeight = size+10;
        l.color = color; l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER; l.overflow = Label.Overflow.SHRINK;
    }
    private mountains(g: Graphics,points: number[][],color: Color) {
        g.fillColor = color; g.moveTo(points[0][0],points[0][1]);
        for (let i = 1; i < points.length; i++) g.lineTo(points[i][0],points[i][1]);
        g.close(); g.fill();
    }
    private layout() {
        if (!this.card) return;
        this.node.getComponent(Widget)!.updateAlignment();
        const size = this.node.getComponent(UITransform)!.contentSize;
        const key = `${size.width}:${size.height}`;
        if (key === this.lastSize) return;
        this.lastSize = key;
        const scale = Math.max(0.1,Math.min((size.width-32)/1080,(size.height-32)/650,1.35));
        this.card.setScale(scale,scale,1);
        this.wash.clear(); this.wash.fillColor = new Color(12,36,42,215);
        this.wash.rect(-size.width/2,-size.height/2,size.width,size.height); this.wash.fill();
    }
    update() { this.layout(); }
}
