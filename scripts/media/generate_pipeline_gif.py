#!/usr/bin/env python3
"""Generate the compact animated NodeVideo pipeline diagram."""

from pathlib import Path
from PIL import Image, ImageColor, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 675
BG = "#090b10"
PANEL = "#131722"
MUTED = "#778199"
TEXT = "#f5f7fb"
ACCENT = "#7c5cff"
GREEN = "#35d07f"
ORANGE = "#ffab45"

STAGES = [
    "Validate", "Ingest", "Learn profile", "Normalize", "Song align", "Reference pose",
    "Take pose", "LocateAnything", "Interpret", "Phrase match", "DP / beam",
    "Legacy lyrics", "Editorial voice", "Compile", "Render", "Validate preview",
    "Review", "Freeze", "Hidden evaluator",
]

DETAIL = {
    "Learn profile": "Authorized prior productions become a reusable, evidence-bound CreatorTasteProfile.",
    "LocateAnything": "Official NVIDIA model grounds the dancer; MediaPipe retains frame-by-frame pose detail.",
    "Interpret": "Content-neutral production semantics explain story, attention, action, and creator intent.",
    "DP / beam": "Global choreography search chooses cuts and takes instead of applying a fixed beat grammar.",
    "Editorial voice": "Commentary, identity, CTA, and end-card cues follow the profile and avoid grounded subjects.",
    "Freeze": "The plan, render, and read log are hash-bound before the target can be opened.",
    "Hidden evaluator": "Conjunctive gates cover structure, semantics, layout, grade, identity, and delivery.",
}
DEFAULT_DETAIL = "Inputs, outputs, lease attempts, and recovery events remain inspectable end to end."


def font(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def center_text(draw, box, value, selected=False, size=17):
    fnt = font(size, selected)
    bounds = draw.textbbox((0, 0), value, font=fnt)
    x = box[0] + (box[2] - box[0] - (bounds[2] - bounds[0])) / 2
    y = box[1] + (box[3] - box[1] - (bounds[3] - bounds[1])) / 2 - 1
    draw.text((x, y), value, font=fnt, fill=TEXT if selected else "#b7bfd0")


def frame(active: int):
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.text((54, 38), "NodeVideo — source-only creative pipeline", font=font(34, True), fill=TEXT)
    draw.text((56, 84), "Every highlighted step is a durable Convex stage with an inspectable artifact.", font=font(18), fill=MUTED)

    inputs = ["Prior edits", "Reference", "Take A", "Take B", "Song", "Brief"]
    for index, label in enumerate(inputs):
        x = 55 + index * 181
        rounded(draw, (x, 125, x + 160, 174), 14, PANEL, "#30384b", 2)
        center_text(draw, (x, 125, x + 160, 174), label, active >= 0)
    draw.line((150, 187, 1050, 187), fill="#30384b", width=3)
    draw.polygon([(1050, 181), (1063, 187), (1050, 193)], fill="#30384b")

    boxes = []
    for index, label in enumerate(STAGES):
        row, column = divmod(index, 7)
        x = 55 + column * 155
        y = 208 + row * 74
        box = (x, y, x + 139, y + 54)
        boxes.append(box)
        complete = index < active
        selected = index == active
        color = GREEN if complete else ACCENT if selected else PANEL
        outline = GREEN if complete else "#9a82ff" if selected else "#30384b"
        rounded(draw, box, 14, color if complete else PANEL, outline, 3 if selected else 2)
        center_text(draw, box, label, complete or selected, 15)
        if index not in (6, 13, len(STAGES) - 1):
            draw.line((box[2] + 3, y + 27, box[2] + 14, y + 27), fill=outline, width=3)
        if index in (6, 13):
            draw.line((box[2] - 60, box[3] + 5, box[2] - 60, box[3] + 32), fill=outline, width=3)

    progress = min(1, max(0, (active + 1) / len(STAGES)))
    rounded(draw, (55, 458, 1145, 470), 6, "#222838")
    rounded(draw, (55, 458, 55 + int(1090 * progress), 470), 6, GREEN)

    current = STAGES[min(max(active, 0), len(STAGES) - 1)]
    accent = ORANGE if current == "Hidden evaluator" else GREEN if active >= len(STAGES) else ACCENT
    rounded(draw, (55, 505, 1145, 625), 22, "#10141d", "#30384b", 2)
    draw.ellipse((83, 538, 117, 572), fill=accent)
    draw.text((140, 523), current, font=font(27, True), fill=TEXT)
    draw.text((140, 565), DETAIL.get(current, DEFAULT_DETAIL), font=font(18), fill="#aab3c7")
    draw.text((995, 638), f"{min(active + 1, len(STAGES)):02d} / {len(STAGES):02d}", font=font(17, True), fill=MUTED)
    return image


# Narrow variant (README on a ~390 px phone shows a 648 px image at 324 css px): no text is smaller than
# 32 px (title 40 px) so every cap height stays >= 10 css px there. Stages sit in 2 columns; the six inputs
# fold into one wrapped line.
NARROW_SIZE = (648, 974)
NARROW_PAD, NARROW_FONT, NARROW_CELL_H, NARROW_GAP = 24, 32, 46, 6
NARROW_INK_ON_GREEN = "#090b10"  # 9.8:1 on GREEN; the wide GIF's white on GREEN is 1.9:1
NARROW_INPUTS = "Inputs: prior edits, reference, take A/B, song, brief"
NARROW_COLORS = 128  # one shared palette for every frame, no dither
NARROW_EXACT = [ORANGE, ACCENT, "#9a82ff", GREEN, NARROW_INK_ON_GREEN, TEXT, MUTED, "#30384b"]


def wrap(draw, text, fnt, max_width):
    lines, current = [], ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    return lines + [current]


def frame_narrow(active: int, anchors=None):
    """One narrow frame. `anchors`, if given, receives {style: (x, baseline, size)} for measuring cap heights."""
    width, height = NARROW_SIZE
    pad, size, cell_h, gap = NARROW_PAD, NARROW_FONT, NARROW_CELL_H, NARROW_GAP
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    regular, bold, title = font(size), font(size, True), font(size + 8, True)
    line_h = round(size * 1.28)
    text_w = width - 2 * pad
    note = lambda style, x, baseline, px: anchors is not None and anchors.__setitem__(style, (x, baseline, px))

    base = pad + round((size + 8) * .74)
    draw.text((pad, base), "NodeVideo", font=title, fill=TEXT, anchor="ls")
    note("title", pad, base, size + 8)
    base += round(size * 1.3)
    draw.text((pad, base), "Source-only creative pipeline", font=regular, fill=MUTED, anchor="ls")
    note("subtitle", pad, base, size)
    for k, line in enumerate(wrap(draw, NARROW_INPUTS, regular, text_w)):
        base += line_h
        draw.text((pad, base), line, font=regular, fill="#b7bfd0", anchor="ls")
        if k == 0:
            note("inputs line", pad, base, size)

    top = base + round(size * .55)
    cell_w = (text_w - gap) // 2
    for index, label in enumerate(STAGES):
        row, column = divmod(index, 2)
        x, y = pad + column * (cell_w + gap), top + row * (cell_h + gap)
        complete, selected = index < active, index == active
        outline = GREEN if complete else "#9a82ff" if selected else "#30384b"
        rounded(draw, (x, y, x + cell_w, y + cell_h), 12, GREEN if complete else PANEL, outline, 3 if selected else 2)
        ink = NARROW_INK_ON_GREEN if complete else TEXT if selected else "#b7bfd0"
        label_x, baseline = x + (cell_w - draw.textlength(label, font=bold)) / 2, y + cell_h / 2 + size * .35
        draw.text((label_x, baseline), label, font=bold, fill=ink, anchor="ls")
        if index == 0:
            note("stage label (cell 0)", label_x, baseline, size)
        if index == 1:
            note("stage label (cell 1)", label_x, baseline, size)

    bar = top + 10 * (cell_h + gap) + 4
    progress = (active + 1) / len(STAGES)
    rounded(draw, (pad, bar, width - pad, bar + 12), 6, "#222838")
    rounded(draw, (pad, bar, pad + int(text_w * progress), bar + 12), 6, GREEN)

    current = STAGES[active]
    accent = ORANGE if current == "Hidden evaluator" else ACCENT
    panel = bar + 36
    rounded(draw, (pad, panel, width - pad, height - pad + 6), 20, "#10141d", "#30384b", 2)
    base = panel + 14 + round(size * .9)
    draw.ellipse((pad + 20, base - 26, pad + 46, base), fill=accent)
    draw.text((pad + 62, base), current, font=bold, fill=TEXT, anchor="ls")
    note("panel title", pad + 62, base, size)
    counter = f"{active + 1:02d} / {len(STAGES):02d}"
    counter_x = width - pad - 20 - draw.textlength(counter, font=bold)
    draw.text((counter_x, base), counter, font=bold, fill=MUTED, anchor="ls")
    note("counter", counter_x, base, size)
    base += round(size * .45)
    for k, line in enumerate(wrap(draw, DETAIL.get(current, DEFAULT_DETAIL), regular, text_w - 40)):
        base += line_h
        draw.text((pad + 20, base), line, font=regular, fill="#aab3c7", anchor="ls")
        if k == 0:
            note("detail", pad + 20, base, size)
    assert base + round(size * .45) + pad <= height, "narrow panel overflows NARROW_SIZE"
    return image


def save_narrow(output: Path):
    frames = [frame_narrow(index) for index in range(len(STAGES))]
    # palette from a mosaic of every frame so the purple, orange and green accents all survive quantising
    mosaic = Image.new("RGB", (NARROW_SIZE[0], NARROW_SIZE[1] * len(frames)))
    for index, image in enumerate(frames):
        mosaic.paste(image, (0, index * NARROW_SIZE[1]))
    learned = mosaic.quantize(colors=NARROW_COLORS - len(NARROW_EXACT), method=Image.Quantize.MEDIANCUT)
    flat = learned.getpalette()[: 3 * (NARROW_COLORS - len(NARROW_EXACT))]
    for colour in NARROW_EXACT:  # median cut weights by pixel count and drops small accents (the orange dot), so pin them
        flat += list(ImageColor.getrgb(colour))
    palette = Image.new("P", (1, 1))
    palette.putpalette(flat)
    frames.extend([frames[-1]] * 8)
    quantised = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in frames]
    # palette= makes Pillow write one global colour table; without it every delta frame gets its own local table
    quantised[0].save(output, save_all=True, append_images=quantised[1:], duration=260, loop=0, optimize=True, palette=bytes(flat))


def main(argv=None):
    import sys

    narrow = "--narrow" in (sys.argv[1:] if argv is None else argv)
    output = Path("fixtures/proof/nodevideo-live-pipeline-narrow.gif" if narrow else "fixtures/proof/nodevideo-live-pipeline.gif")
    output.parent.mkdir(parents=True, exist_ok=True)
    if narrow:
        save_narrow(output)
    else:
        frames = [frame(index) for index in range(len(STAGES))]
        frames.extend([frame(len(STAGES) - 1)] * 8)
        frames[0].save(output, save_all=True, append_images=frames[1:], duration=260, loop=0, optimize=True)
    print(output)


if __name__ == "__main__":
    main()
