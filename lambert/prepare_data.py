"""Regenerate Lambert's lightweight data and lossless images (requires Pillow)."""

import base64
import io
import json
import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "portfolio/assets/saliency/viz_data.js").read_text()
data = json.loads(source.removeprefix("const SALIENCY_DATA = ").rstrip(";\n"))
filenames = {
    "wolf_after_release_1000_odfw": "wolf-energy.webp",
    "car": "car-energy.webp",
    "houses": "houses-energy.webp",
}

for name, filename in filenames.items():
    item = data[name]
    original = Image.open(io.BytesIO(base64.b64decode(item["energy"].split(",", 1)[1]))).convert("RGB")
    target = ROOT / "assets/lambert" / filename
    original.save(target, format="WEBP", lossless=True, method=6)
    assert Image.open(target).convert("RGB").tobytes() == original.tobytes()
    item["energy"] = f"../assets/lambert/{filename}"
    print(f"{target.relative_to(ROOT)}: {target.stat().st_size:,} bytes, identical pixels")

page = ROOT / "lambert/index.html"
payload = json.dumps(data, separators=(",", ":"))
html, count = re.subn(
    r'<script id="saliency-data">[\s\S]*?</script>',
    lambda _: f'<script id="saliency-data">const SALIENCY_DATA = {payload};</script>',
    page.read_text(),
)
assert count == 1, "Expected exactly one saliency-data script"
page.write_text(html)
print(f"Inline chart data: {len(payload):,} bytes")
