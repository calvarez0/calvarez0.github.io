#!/usr/bin/env python3
"""Generate Lambert saliency reveal GIFs from 0 pixels to L2."""

from __future__ import annotations

import base64
import io
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "portfolio" / "assets" / "saliency" / "viz_data.js"
OUTPUT_DIR = ROOT / "assets" / "lambert"

# Matches the selector names in lambert.html
TARGET_IMAGE_KEYS = ["wolf_after_release_1000_odfw", "car", "houses"]

# 40 frames * 50ms = 2000ms total
FRAME_COUNT = 40
FRAME_DURATION_MS = 50

PREVIEW_OUTPUT_NAME = "saliency_process_preview_v6.gif"
# Positive = move content up, negative = move content down.
# For the wolf segment we move content down so eyes stay visible in mobile crop.
WOLF_VERTICAL_SHIFT_PX = -64


def load_saliency_data(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    prefix = "const SALIENCY_DATA = "
    start = text.find(prefix)
    if start == -1:
        raise ValueError(f"Could not find SALIENCY_DATA in: {path}")

    payload = text[start + len(prefix) :].strip()
    if payload.endswith(";"):
        payload = payload[:-1]
    return json.loads(payload)


def decode_energy_image(data_uri: str) -> np.ndarray:
    if "," not in data_uri:
        raise ValueError("Unsupported image URI format")

    header, encoded = data_uri.split(",", 1)
    if ";base64" not in header:
        raise ValueError("Expected base64 image URI")

    raw = base64.b64decode(encoded)
    with Image.open(io.BytesIO(raw)) as img:
        return np.asarray(img.convert("RGB"), dtype=np.uint8)


def compute_l2_slider_fraction(entry: dict) -> float:
    """
    Replicates lambert.html chart mapping:
      xScale(E) = left + plotW * (1 - (log10(E)-eMin)/(eMax-eMin))
      threshX   = left + (slider/1000) * plotW

    So slider fraction at L2 is:
      slider/1000 = 1 - (log10(L2)-eMin)/(eMax-eMin)
    """
    hist = entry.get("histogram", {})
    bin_centers = np.asarray(hist.get("binCenters", []), dtype=np.float64)
    h_pmf = np.asarray(hist.get("hPmf", []), dtype=np.float64)

    if bin_centers.size == 0 or h_pmf.size != bin_centers.size:
        return 1.0

    valid = (bin_centers > 0) & (h_pmf > 0)
    if not np.any(valid):
        return 1.0

    valid_e = bin_centers[valid]
    e_min = math.log10(float(valid_e.min()))
    e_max = math.log10(float(valid_e.max()))
    if math.isclose(e_min, e_max):
        return 1.0

    l2 = float(hist.get("L2", float(valid_e.max())))
    l2 = min(max(l2, float(valid_e.min())), float(valid_e.max()))

    fraction = 1.0 - (math.log10(l2) - e_min) / (e_max - e_min)
    return float(np.clip(fraction, 0.0, 1.0))


def build_reveal_order(rgb: np.ndarray, name: str) -> np.ndarray:
    """Sort pixels by descending energy + tie-break (matches lambert.html intent)."""
    energy = rgb[:, :, 0].astype(np.float32)

    # Deterministic tie-breaker so outputs are reproducible.
    seed = int.from_bytes(name.encode("utf-8"), "little", signed=False) % (2**32)
    rng = np.random.default_rng(seed)
    tie_break = rng.random(energy.shape).astype(np.float32) * 0.99

    sort_key = (energy + tie_break).reshape(-1)
    return np.argsort(sort_key)[::-1]


def render_frames(rgb: np.ndarray, reveal_order: np.ndarray, target_count: int) -> list[Image.Image]:
    flat_rgb = rgb.reshape(-1, 3)
    pixel_count = flat_rgb.shape[0]
    target_count = int(np.clip(target_count, 0, pixel_count))

    frames: list[Image.Image] = []
    for frame_idx in range(FRAME_COUNT):
        progress = frame_idx / (FRAME_COUNT - 1)
        reveal_count = int(math.floor(progress * target_count))

        canvas = np.zeros((pixel_count, 3), dtype=np.uint8)
        if reveal_count > 0:
            reveal_indices = reveal_order[:reveal_count]
            canvas[reveal_indices] = flat_rgb[reveal_indices]

        frame = Image.fromarray(canvas.reshape(rgb.shape), mode="RGB")
        frames.append(frame)

    return frames


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug or "image"


def save_gif(frames: list[Image.Image], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_DURATION_MS,
        loop=0,
        optimize=False,
        disposal=2,
    )


def load_gif_frames(path: Path) -> tuple[list[Image.Image], list[int]]:
    frames: list[Image.Image] = []
    durations: list[int] = []

    with Image.open(path) as gif:
        total = getattr(gif, "n_frames", 1)
        for idx in range(total):
            gif.seek(idx)
            frames.append(gif.convert("RGB").copy())
            durations.append(int(gif.info.get("duration", FRAME_DURATION_MS)))

    return frames, durations


def shift_frame_vertical(frame: Image.Image, shift_px: int) -> Image.Image:
    """Shift content vertically while keeping output size constant."""
    arr = np.asarray(frame, dtype=np.uint8)
    height = arr.shape[0]
    shift_px = max(-(height - 1), min(height - 1, int(shift_px)))
    if shift_px == 0:
        return frame.copy()

    shifted = np.empty_like(arr)
    if shift_px > 0:
        shifted[: height - shift_px] = arr[shift_px:]
        shifted[height - shift_px :] = arr[height - shift_px :]
    else:
        down_px = abs(shift_px)
        shifted[down_px:] = arr[: height - down_px]
        shifted[:down_px] = arr[:down_px]
    return Image.fromarray(shifted, mode="RGB")


def compose_preview_gif(output_path: Path) -> None:
    segment_paths = [
        OUTPUT_DIR / "wolf_0_to_l2.gif",
        OUTPUT_DIR / "car_0_to_l2.gif",
        OUTPUT_DIR / "houses_0_to_l2.gif",
    ]

    combined_frames: list[Image.Image] = []
    combined_durations: list[int] = []

    for idx, segment_path in enumerate(segment_paths):
        if not segment_path.exists():
            raise FileNotFoundError(f"Missing segment GIF: {segment_path}")

        frames, durations = load_gif_frames(segment_path)
        if idx == 0:
            # Wolf segment only: tune vertical framing independently.
            frames = [shift_frame_vertical(frame, WOLF_VERTICAL_SHIFT_PX) for frame in frames]

        combined_frames.extend(frames)
        combined_durations.extend(durations)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined_frames[0].save(
        output_path,
        save_all=True,
        append_images=combined_frames[1:],
        duration=combined_durations,
        loop=0,
        optimize=False,
        disposal=2,
    )


def main() -> None:
    data = load_saliency_data(DATA_PATH)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for key in TARGET_IMAGE_KEYS:
        if key not in data:
            raise KeyError(f"Missing image key in SALIENCY_DATA: {key}")

        entry = data[key]
        display_name = entry.get("displayName", key)

        rgb = decode_energy_image(entry["energy"])
        reveal_order = build_reveal_order(rgb, key)

        slider_fraction_at_l2 = compute_l2_slider_fraction(entry)
        target_count = int(math.floor(slider_fraction_at_l2 * reveal_order.size))

        frames = render_frames(rgb, reveal_order, target_count)

        output_name = f"{slugify(display_name)}_0_to_l2.gif"
        output_path = OUTPUT_DIR / output_name
        save_gif(frames, output_path)

        print(
            f"Generated {output_path.relative_to(ROOT)} "
            f"(size={rgb.shape[1]}x{rgb.shape[0]}, "
            f"L2-slider={slider_fraction_at_l2:.4f}, pixels={target_count}/{reveal_order.size})"
        )

    preview_path = OUTPUT_DIR / PREVIEW_OUTPUT_NAME
    compose_preview_gif(preview_path)
    print(f"Generated {preview_path.relative_to(ROOT)} (wolf shifted up by {WOLF_VERTICAL_SHIFT_PX}px)")


if __name__ == "__main__":
    main()
