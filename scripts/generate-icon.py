from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 512
SCALE = 4
root = Path(__file__).resolve().parent.parent
output = root / "build" / "icon.png"
output.parent.mkdir(parents=True, exist_ok=True)

image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (5, 6, 8, 255))
draw = ImageDraw.Draw(image)

def line(points, color, width):
    draw.line([(x * SCALE, y * SCALE) for x, y in points], fill=color, width=width * SCALE, joint="curve")

cyan = (44, 201, 255, 255)
muted = (44, 201, 255, 90)
line([(256, 54), (432, 154), (432, 358), (256, 458), (80, 358), (80, 154), (256, 54)], muted, 5)
line([(148, 342), (256, 122), (364, 342), (256, 404), (148, 342)], cyan, 9)
line([(190, 300), (322, 300)], cyan, 7)
draw.ellipse((238 * SCALE, 250 * SCALE, 274 * SCALE, 286 * SCALE), fill=cyan)

image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
image.save(output)
image.save(output.with_suffix(".ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(output)
