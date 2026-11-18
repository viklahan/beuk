"""THE CALLING — Blender launchpad for the Aris hero (option C, 2026-11-18).

Builds the whole scene from scratch in Blender 4.4:
  - the real Aris laurel (the five product glyph paths) as beveled gold curves
  - ~9,000 emissive motes on a Geometry Nodes setup with ONE slider:
        "Calling"  0.0 = chaos cloud  ->  1.0 = the laurel, formed
    (keyframed 0->1 over frames 1-120 so a play-through IS the calling)
  - dark world, tri-light rig (gold key / cyan rim / violet fill), camera

Run it either way:
  blender --background --factory-startup --python the_calling_launchpad.py
      (saves the_calling.blend next to this file)
  or open Blender > Scripting tab > open this file > Run Script.

Everything is plain objects and one node group — nothing opaque. Tweak the
"Calling" slider on the Motes object's modifier, re-time the keyframes,
swap the mote instance for petals/glyphs, add volumetrics, go wild.
"""
import bpy
import os
import re

# ---------------------------------------------------------------- the glyph
# The five paths from studio/src/aris/index.ts — a stem and paired leaves.
LAUREL = [
    "M12 21C12 15 12 9 12 3",
    "M12 17C8 17 6 14 6 11C9 11 11 13 12 17",
    "M12 17C16 17 18 14 18 11C15 11 13 13 12 17",
    "M12 11C8.5 10.5 7 8 7 5.5C10 6 11.5 8 12 11",
    "M12 11C15.5 10.5 17 8 17 5.5C14 6 12.5 8 12 11",
]
SCALE = 0.42          # 24 SVG units -> ~10 Blender units tall
GOLD = (0.85, 0.63, 0.25, 1.0)
PALETTE = [(0.91, 0.77, 0.42), (0.10, 0.89, 0.89), (0.17, 0.85, 0.55), (0.49, 0.23, 0.93)]
DENSITY = 0.005       # one mote every DENSITY units of curve length (~8k on the laurel)
SPREAD = 9.0          # chaos-cloud half-extent


def svg_to_world(x, y):
    """SVG (y down, 0..24) -> world XZ plane, standing, centered on origin."""
    return ((x - 12.0) * SCALE, 0.0, (21.0 - y) * SCALE)


def parse_path(d):
    """'M x y C h1x h1y h2x h2y px py [C ...]' -> (start, [(h1, h2, p), ...])."""
    nums = [float(n) for n in re.findall(r"-?\d+\.?\d*", d)]
    start, rest = (nums[0], nums[1]), nums[2:]
    segs = [tuple(rest[i:i + 6]) for i in range(0, len(rest), 6)]
    return start, segs


def build_laurel():
    curve = bpy.data.curves.new("ArisLaurel", type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.085
    curve.bevel_resolution = 6
    curve.resolution_u = 24
    for d in LAUREL:
        (sx, sy), segs = parse_path(d)
        sp = curve.splines.new("BEZIER")
        sp.bezier_points.add(len(segs))  # one exists already
        pts = sp.bezier_points
        pts[0].co = svg_to_world(sx, sy)
        prev = (sx, sy)
        for i, (h1x, h1y, h2x, h2y, px, py) in enumerate(segs):
            pts[i].handle_right = svg_to_world(h1x, h1y)
            pts[i + 1].handle_left = svg_to_world(h2x, h2y)
            pts[i + 1].co = svg_to_world(px, py)
            prev = (px, py)
        for p in pts:  # free handles; fill the two ends sensibly
            p.handle_left_type = p.handle_right_type = "FREE"
        pts[0].handle_left = pts[0].co
        pts[-1].handle_right = pts[-1].co
    obj = bpy.data.objects.new("ArisLaurel", curve)
    bpy.context.scene.collection.objects.link(obj)

    mat = bpy.data.materials.new("LaurelGold")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = GOLD
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.28
    bsdf.inputs["Emission Color"].default_value = GOLD
    bsdf.inputs["Emission Strength"].default_value = 0.5
    obj.data.materials.append(mat)
    return obj


def mote_material():
    mat = bpy.data.materials.new("MoteLight")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 2.2  # AgX washes >3 to white; Standard view transform set below
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*PALETTE[0], 1)
    ramp.color_ramp.elements[1].color = (*PALETTE[3], 1)
    for pos, col in ((0.35, PALETTE[1]), (0.65, PALETTE[2])):
        e = ramp.color_ramp.elements.new(pos)
        e.color = (*col, 1)
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "hue"
    nt.links.new(attr.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def build_text_target(name, text, size, z):
    """A hidden text object the motes can form instead of the laurel.
    Its outline is what gets sampled — dotted letterforms, like a marquee."""
    data = bpy.data.curves.new(name, type="FONT")
    data.body = text
    data.size = size
    data.align_x = "CENTER"
    try:
        data.font = bpy.data.fonts.load(r"C:\Windows\Fonts\georgia.ttf")
    except Exception:
        pass  # Bfont fallback; pick any font on the object later
    obj = bpy.data.objects.new(name, data)
    obj.location = (0, 0, z)
    obj.rotation_euler = (1.5707963, 0, 0)  # face the camera (XZ plane)
    bpy.context.scene.collection.objects.link(obj)
    # Fonts evaluate through their own fill machinery, which the Resample
    # node skips — convert to a plain curve object so the motes treat text
    # exactly like the laurel. (Edit the text? Change `body` above, rerun.)
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.convert(target="CURVE")
    obj.data.fill_mode = "NONE"
    obj.hide_render = obj.hide_viewport = True  # a target, not an actor
    return obj


def build_motes(target_obj):
    mesh = bpy.data.meshes.new("MotesBase")
    obj = bpy.data.objects.new("Motes", mesh)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new("TheCalling", "NODES")
    ng = bpy.data.node_groups.new("TheCalling", "GeometryNodeTree")
    mod.node_group = ng

    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    calling = ng.interface.new_socket("Calling", in_out="INPUT", socket_type="NodeSocketFloat")
    calling.default_value, calling.min_value, calling.max_value = 1.0, 0.0, 1.0
    target_sock = ng.interface.new_socket("Target", in_out="INPUT", socket_type="NodeSocketObject")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")

    n = ng.nodes
    gin = n.new("NodeGroupInput")
    gout = n.new("NodeGroupOutput")

    # what the motes form — the modifier's Target dropdown decides
    # (ArisLaurel, LetterA, WordAris, or anything with curves).
    # RELATIVE space: the target's own transform (the text stands up, the
    # word floats) comes along — Original would flatten text to the floor.
    info = n.new("GeometryNodeObjectInfo")
    info.transform_space = "RELATIVE"
    # THE MOTES ARE THE TARGET'S OWN POINTS: resample the target's curves
    # uniform-by-arc-length, turn every control point into a mote, and let
    # "Calling" mix each mote between its own Index-seeded chaos position
    # and its home on the curve. No cross-geometry sampling, no counting —
    # mote count simply follows the target's total length (density DENSITY).
    resample = n.new("GeometryNodeResampleCurve")
    resample.mode = "LENGTH"
    resample.inputs["Length"].default_value = DENSITY
    c2p = n.new("GeometryNodeCurveToPoints")
    c2p.mode = "EVALUATED"
    pos = n.new("GeometryNodeInputPosition")

    # the chaos cloud: a stable random spot per mote
    chaos = n.new("FunctionNodeRandomValue")
    chaos.data_type = "FLOAT_VECTOR"
    chaos.inputs[0].default_value = (-SPREAD, -SPREAD * 0.35, -SPREAD * 0.15)
    chaos.inputs[1].default_value = (SPREAD, SPREAD * 0.35, SPREAD * 1.15)

    # 0 -> chaos, 1 -> formed
    mix = n.new("ShaderNodeMix")
    mix.data_type = "VECTOR"
    setpos = n.new("GeometryNodeSetPosition")

    # a stable random per mote, for colour and size
    hue = n.new("FunctionNodeRandomValue")
    hue.data_type = "FLOAT"
    store = n.new("GeometryNodeStoreNamedAttribute")
    store.data_type = "FLOAT"
    store.domain = "POINT"
    store.inputs["Name"].default_value = "hue"

    sphere = n.new("GeometryNodeMeshIcoSphere")
    sphere.inputs["Radius"].default_value = 0.045
    sphere.inputs["Subdivisions"].default_value = 1
    size = n.new("FunctionNodeRandomValue")
    size.data_type = "FLOAT"
    size.inputs[2].default_value = 0.5
    size.inputs[3].default_value = 1.6
    inst = n.new("GeometryNodeInstanceOnPoints")
    realize = n.new("GeometryNodeRealizeInstances")
    setmat = n.new("GeometryNodeSetMaterial")
    setmat.inputs["Material"].default_value = mote_material()

    L = ng.links.new
    L(gin.outputs["Target"], info.inputs["Object"])
    L(info.outputs["Geometry"], resample.inputs["Curve"])
    L(resample.outputs["Curve"], c2p.inputs["Curve"])
    L(chaos.outputs["Value"], mix.inputs[4])        # A (vector): chaos
    L(pos.outputs["Position"], mix.inputs[5])       # B (vector): home on the curve
    L(gin.outputs["Calling"], mix.inputs["Factor"])
    L(c2p.outputs["Points"], setpos.inputs["Geometry"])
    L(mix.outputs[1], setpos.inputs["Position"])    # vector result
    L(setpos.outputs["Geometry"], store.inputs["Geometry"])
    L(hue.outputs[1], store.inputs["Value"])
    L(store.outputs["Geometry"], inst.inputs["Points"])
    L(sphere.outputs["Mesh"], inst.inputs["Instance"])
    L(size.outputs[1], inst.inputs["Scale"])
    L(inst.outputs["Instances"], realize.inputs["Geometry"])
    L(realize.outputs["Geometry"], setmat.inputs["Geometry"])
    L(setmat.outputs["Geometry"], gout.inputs["Geometry"])

    # default target: the name (any curve object can take its place)
    mod[target_sock.identifier] = target_obj

    # a play-through IS the calling: 0 at frame 1, formed by frame 120
    ident = calling.identifier
    mod[ident] = 0.0
    mod.keyframe_insert(data_path=f'["{ident}"]', frame=1)
    mod[ident] = 1.0
    mod.keyframe_insert(data_path=f'["{ident}"]', frame=120)
    return obj


def build_stage():
    world = bpy.data.worlds.new("ArisNight")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.012, 0.010, 0.022, 1)
    bg.inputs["Strength"].default_value = 0.25

    def light(name, kind, loc, rot, color, energy, size=6.0):
        data = bpy.data.lights.new(name, kind)
        data.color, data.energy = color, energy
        if kind == "AREA":
            data.size = size
        ob = bpy.data.objects.new(name, data)
        ob.location, ob.rotation_euler = loc, rot
        bpy.context.scene.collection.objects.link(ob)

    light("KeyGold", "AREA", (7, -9, 9), (0.9, 0.5, 0.5), (1.0, 0.82, 0.5), 1600)
    light("RimCyan", "AREA", (-8, 7, 7), (1.0, -0.6, -2.4), (0.25, 0.95, 0.95), 900)
    light("FillViolet", "AREA", (0, -6, -2), (-1.3, 0, 0), (0.55, 0.3, 1.0), 400)

    aim = bpy.data.objects.new("CameraAim", None)
    aim.location = (0, 0, 3.6)
    bpy.context.scene.collection.objects.link(aim)
    cam = bpy.data.cameras.new("Camera")
    cam.lens = 60
    camob = bpy.data.objects.new("Camera", cam)
    camob.location = (0, -20, 4.2)
    bpy.context.scene.collection.objects.link(camob)
    tr = camob.constraints.new("TRACK_TO")
    tr.target = aim
    bpy.context.scene.camera = camob

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.frame_start, sc.frame_end = 1, 180
    # AgX (the default) grades bright emission to white — the palette vanished
    # in the first bake. Standard keeps the motes gold/cyan/green/violet; swap
    # back to AgX/Filmic if you grade in post instead.
    sc.view_settings.view_transform = "Standard"


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    # Word-only (V, 2026-11-18): the motes form the name. The laurel is one
    # line away if ever wanted back: laurel = build_laurel(); point Target at it.
    word = build_text_target("WordAris", "Aris", 4.5, 2.2)
    build_motes(word)
    build_stage()
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else bpy.path.abspath("//") or os.getcwd()
    out = os.path.join(here, "the_calling.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print(f"[the-calling] saved {out}")


main()
