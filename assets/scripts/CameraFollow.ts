import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('CameraFollow')
export class CameraFollow extends Component {
    @property(Node)
    target: Node | null = null;

    @property
    cameraHeight: number = 14;

    @property
    distanceBehind: number = 10;

    @property
    pitchAngle: number = -40;

    lateUpdate() {
        if (!this.target) {
            return;
        }

        const p = this.target.worldPosition;

        this.node.setWorldPosition(
            p.x,
            this.cameraHeight,
            p.z + this.distanceBehind,
        );

        this.node.setWorldRotationFromEuler(
            this.pitchAngle,
            0,
            0,
        );
    }
}