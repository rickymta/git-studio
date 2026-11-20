"""Draw the folder overlay badges (Explorer .ico, Finder / Nautilus .png).

    python scripts/overlay-icons.py

Writes src-tauri/overlay/overlay-{clean,changed,danger}.{ico,png}. The badge sits in the
bottom-left corner of the icon square, like TortoiseGit's, so the file manager can draw the
whole square over the folder icon.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "overlay"

BADGES = {
    # Same hues as the app's success / warning / danger tokens.
    "clean": ((46, 160, 67), "check"),
    "changed": ((230, 138, 0), "dot"),
    "danger": ((218, 54, 51), "bang"),
}

SIZES = [16, 20, 24, 32, 48, 64, 128, 256]


def badge(size: int, color, glyph: str, corner: bool) -> Image.Image:
    """`corner`: badge in the bottom-left half (overlays); otherwise the full square (emblems)."""
    scale = 8  # draw large, then downsample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Overlays: about 3/4 of the icon wide, so the badge reads at 16 px (Details view) too.
    r = s * (0.36 if corner else 0.48)
    cx, cy = (r + s * 0.02, s - r - s * 0.02) if corner else (s / 2, s / 2)
    border = max(scale, s * 0.03)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))
    d.ellipse((cx - r + border, cy - r + border, cx + r - border, cy + r - border), fill=color + (255,))
    w = max(scale * 1.6, r * 0.24)
    white = (255, 255, 255, 255)
    if glyph == "check":
        pts = [(cx - r * 0.45, cy + r * 0.02), (cx - r * 0.1, cy + r * 0.36), (cx + r * 0.48, cy - r * 0.34)]
        d.line(pts, fill=white, width=int(w), joint="curve")
    elif glyph == "dot":
        k = r * 0.3
        d.ellipse((cx - k, cy - k, cx + k, cy + k), fill=white)
    else:
        d.line([(cx, cy - r * 0.52), (cx, cy + r * 0.12)], fill=white, width=int(w))
        k = w * 0.62
        d.ellipse((cx - k, cy + r * 0.42 - k, cx + k, cy + r * 0.42 + k), fill=white)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (color, glyph) in BADGES.items():
        frames = [badge(n, color, glyph, corner=True) for n in SIZES]
        frames[-1].save(OUT / f"overlay-{name}.ico", sizes=[(n, n) for n in SIZES], append_images=frames[:-1])
        # Emblems (Nautilus / Nemo / Caja) and Finder badges: the badge alone, full square.
        badge(128, color, glyph, corner=False).save(OUT / f"overlay-{name}.png")
    print(f"wrote icons to {OUT}")


if __name__ == "__main__":
    main()
