#!/usr/bin/env python3
"""Build the public side-by-side LocateAnything inspection image."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def font(size: int, bold: bool = False):
    path = Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def fit(image: Image.Image, width: int, height: int):
    copy = image.copy()
    copy.thumbnail((width, height), Image.Resampling.LANCZOS)
    return copy


def main():
    root = Path("fixtures/media/locate-anything-live-v1")
    inputs = [
        ("NodeVideo generated frame", Image.open(root / "input-frame.jpg").convert("RGB")),
        ("NVIDIA LocateAnything-3B", Image.open(root / "annotated.png").convert("RGB")),
    ]
    canvas = Image.new("RGB", (1200, 740), "#090b10")
    draw = ImageDraw.Draw(canvas)
    draw.text((55, 35), "Same frame, inspectable grounding", font=font(34, True), fill="#f5f7fb")
    draw.text((55, 82), "Prompt: primary dancer full body · output coordinates normalized from NVIDIA's 0–1000 space", font=font(18), fill="#8d98ae")
    for index, (label, source) in enumerate(inputs):
        x = 55 + index * 565
        image = fit(source, 520, 570)
        draw.rounded_rectangle((x, 125, x + 520, 690), radius=18, fill="#131722", outline="#30384b", width=2)
        canvas.paste(image, (x + (520 - image.width) // 2, 150 + (510 - image.height) // 2))
        bounds = draw.textbbox((0, 0), label, font=font(22, True))
        draw.text((x + (520 - (bounds[2] - bounds[0])) / 2, 650), label, font=font(22, True), fill="#f5f7fb")
    output = Path("fixtures/proof/locateanything-side-by-side.jpg")
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, quality=91, optimize=True)
    print(output)


if __name__ == "__main__":
    main()
