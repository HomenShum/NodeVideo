#!/usr/bin/env python3
"""Generate the compact animated NodeVideo pipeline diagram."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 675
BG = "#090b10"
PANEL = "#131722"
MUTED = "#778199"
TEXT = "#f5f7fb"
ACCENT = "#7c5cff"
GREEN = "#35d07f"
ORANGE = "#ffab45"

STAGES = [
    "Validate", "Ingest", "Normalize", "Song align", "Reference pose", "Take pose",
    "LocateAnything", "Phrase match", "DP / beam", "Place lyrics", "Compile", "Render",
    "Validate preview", "Review", "Freeze", "Hidden evaluator",
]


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


def center_text(draw, box, value, selected=False):
    fnt = font(17, selected)
    bounds = draw.textbbox((0, 0), value, font=fnt)
    x = box[0] + (box[2] - box[0] - (bounds[2] - bounds[0])) / 2
    y = box[1] + (box[3] - box[1] - (bounds[3] - bounds[1])) / 2 - 1
    draw.text((x, y), value, font=fnt, fill=TEXT if selected else "#b7bfd0")


def frame(active: int):
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.text((54, 38), "NodeVideo — source-only creative pipeline", font=font(34, True), fill=TEXT)
    draw.text((56, 84), "Every highlighted step is a durable Convex stage with an inspectable artifact.", font=font(18), fill=MUTED)

    inputs = ["Choreography", "Take A", "Take B", "Song", "Lyrics"]
    for index, label in enumerate(inputs):
        x = 55 + index * 218
        rounded(draw, (x, 125, x + 190, 174), 14, PANEL, "#30384b", 2)
        center_text(draw, (x, 125, x + 190, 174), label, active >= 0)
    draw.line((150, 187, 1050, 187), fill="#30384b", width=3)
    draw.polygon([(1050, 181), (1063, 187), (1050, 193)], fill="#30384b")

    boxes = []
    for index, label in enumerate(STAGES):
        row, column = divmod(index, 8)
        x = 55 + column * 137
        y = 224 + row * 104
        box = (x, y, x + 121, y + 62)
        boxes.append(box)
        complete = index < active
        selected = index == active
        color = GREEN if complete else ACCENT if selected else PANEL
        outline = GREEN if complete else "#9a82ff" if selected else "#30384b"
        rounded(draw, box, 14, color if complete else PANEL, outline, 3 if selected else 2)
        center_text(draw, box, label, complete or selected)
        if index not in (7, 15):
            draw.line((box[2] + 3, y + 31, box[2] + 14, y + 31), fill=outline, width=3)
        if index == 7:
            draw.line((box[2] - 60, box[3] + 5, box[2] - 60, box[3] + 32), fill=outline, width=3)

    progress = min(1, max(0, (active + 1) / len(STAGES)))
    rounded(draw, (55, 458, 1145, 470), 6, "#222838")
    rounded(draw, (55, 458, 55 + int(1090 * progress), 470), 6, GREEN)

    current = STAGES[min(max(active, 0), len(STAGES) - 1)]
    accent = ORANGE if current == "Hidden evaluator" else GREEN if active >= len(STAGES) else ACCENT
    rounded(draw, (55, 505, 1145, 625), 22, "#10141d", "#30384b", 2)
    draw.ellipse((83, 538, 117, 572), fill=accent)
    draw.text((140, 523), current, font=font(27, True), fill=TEXT)
    detail = {
        "LocateAnything": "Official NVIDIA model grounds the dancer; MediaPipe retains frame-by-frame pose detail.",
        "DP / beam": "Global choreography search chooses cuts and takes instead of applying a fixed beat grammar.",
        "Freeze": "The plan, render, and read log are hash-bound before the target can be opened.",
        "Hidden evaluator": "The isolated evaluator measures every cut against the owner target after freeze.",
    }.get(current, "Inputs, outputs, lease attempts, and recovery events remain inspectable end to end.")
    draw.text((140, 565), detail, font=font(18), fill="#aab3c7")
    draw.text((995, 638), f"{min(active + 1, 16):02d} / 16", font=font(17, True), fill=MUTED)
    return image


def main():
    output = Path("fixtures/proof/nodevideo-live-pipeline.gif")
    output.parent.mkdir(parents=True, exist_ok=True)
    frames = [frame(index) for index in range(len(STAGES))]
    frames.extend([frame(len(STAGES) - 1)] * 8)
    frames[0].save(output, save_all=True, append_images=frames[1:], duration=260, loop=0, optimize=True)
    print(output)


if __name__ == "__main__":
    main()
