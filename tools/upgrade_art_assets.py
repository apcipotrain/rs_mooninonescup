"""Idempotent serialized prefab wiring. Keeps every existing UUID and legacy mesh reference."""
import copy
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def identity(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'moon-in-ones-cup/art-v1/' + name))


def meta(path, importer, version):
    target = Path(str(path) + '.meta')
    if not target.exists():
        write(target, dict(ver=version, importer=importer, imported=True,
                           uuid=identity(path.name), files=[], subMetas={}, userData={}))
    return read(target)['uuid']


def compressed(value):
    h = value.replace('-', '')
    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    return h[:5] + ''.join(chars[int(h[i:i+3],16) >> 6] + chars[int(h[i:i+3],16) & 63]
                           for i in range(5,32,3))


def color(r, g, b, a=255):
    return dict(__type__='cc.Color', r=r, g=g, b=b, a=a)


def main():
    art_uuid = meta(ASSETS/'scripts/PropArt.ts', 'typescript', '4.0.24')
    meta(ASSETS/'scripts/LevelCover.ts', 'typescript', '4.0.24')
    unlit = 'a3cd009f-0ab0-420d-9278-b9fdab939bbc'
    palette = read(ASSETS/'materials/Mat_LaserBeam.mtl')
    palette['_name'] = 'Mat_PropPalette'
    palette['_effectAsset']['__uuid__'] = unlit
    palette['_techIdx'] = 0
    palette['_defines'] = [{'USE_VERTEX_COLOR': True}, {}, {}]
    palette['_states'] = [{}, {}, {}]
    palette['_props'] = [{'mainColor': color(255,255,255)}, {}, {}]
    path = ASSETS/'materials/Mat_PropPalette.mtl'
    write(path, palette)
    palette_uuid = meta(path,'material','1.0.21')
    pane = copy.deepcopy(palette)
    pane['_name'] = 'Mat_GlassPane'
    pane['_techIdx'] = 1
    pane['_props'][0]['mainColor'] = color(255,255,255,145)
    pane['_states'][0] = {'depthStencilState': {'depthTest': True, 'depthWrite': False}}
    pane_path = ASSETS/'materials/Mat_GlassPane.mtl'
    write(pane_path,pane)
    glass_uuid = meta(pane_path,'material','1.0.21')

    kinds = dict(Tile='tile', GlassTileSmall='glass', JumpTile='jump', Diamond='diamond',
                 Crown='crown', MountainObstacle='mountain', TeleportGate='teleport',
                 LaserEmitter='emitter', LaserBeam='beam')
    for name, kind in kinds.items():
        path = ASSETS/'prefabs'/f'{name}.prefab'
        data = read(path)
        component_type = compressed(art_uuid)
        component = next((o for o in data if o['__type__'] == component_type or
                          (o.get('kind') == kind and 'palette' in o)), None)
        if component is None:
            component = dict(__type__=component_type, _name='', _objFlags=0, __editorExtras__={},
                             node={'__id__':1}, _enabled=True, __prefab=None, _id='')
            index = len(data)
            data.append(component)
            data[1]['_components'].append({'__id__':index})
        component.update(__type__=component_type,kind=kind, palette={'__uuid__':palette_uuid,'__expectedType__':'cc.Material'},
                         glassMaterial={'__uuid__':glass_uuid,'__expectedType__':'cc.Material'})
        write(path,data)

    # Harmonize the preserved source materials too, so old visual children remain useful fallbacks.
    colors = {'TileBorder':(128,159,143), 'GlassBorder':(131,220,226),
              'Mat_Diamond':(89,209,221), 'Mat_CrownGold':(222,169,72),
              'Mat_CrownGem':(194,77,88), 'Mat_Mountain':(58,139,127),
              'Mat_JumpTile':(181,96,44)}
    for name,rgb in colors.items():
        p = ASSETS/'materials'/f'{name}.mtl'
        data = read(p)
        data['_props'][0]['mainColor'] = color(*rgb)
        data['_props'][0].pop('emissive',None)
        write(p,data)
    # Remove screenshot texture use from legacy gate/emitter materials without deleting textures.
    for name,rgb in [('Mat_TeleportEffect',(89,209,221)),('Mat_LaserEmitter',(58,139,127)),
                     ('Mat_LaserBeam',(250,118,65))]:
        p = ASSETS/'materials'/f'{name}.mtl'
        data = read(p)
        data['_techIdx'] = 0
        data['_defines'] = [{}, {}, {}]
        data['_props'] = [{'mainColor':color(*rgb)}, {}, {}]
        write(p,data)
    # The normal tile's body used an engine default material; give the fallback an explicit project asset.
    tile = ASSETS/'prefabs/Tile.prefab'
    data = read(tile)
    body = copy.deepcopy(read(ASSETS/'materials/Mat_Mountain.mtl'))
    body['_name'] = 'Mat_TileSurface'
    body['_props'][0]['mainColor'] = color(72,111,107)
    path = ASSETS/'materials/Mat_TileSurface.mtl'
    write(path,body)
    body_uuid = meta(path,'material','1.0.21')
    for obj in data:
        if obj['__type__'] == 'cc.MeshRenderer' and obj.get('node') == {'__id__':1}:
            obj['_materials'] = [{'__uuid__':body_uuid,'__expectedType__':'cc.Material'}]
    write(tile,data)
    print('Wired 9 existing prefabs; preserved their UUIDs and source mesh references.')


if __name__ == '__main__':
    main()
