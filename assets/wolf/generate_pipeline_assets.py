"""Generate the intermediate response maps used by lambert.html.

The implementation follows Appendix A.1 of saliency_thresholds.pdf: a
difference-of-Gaussians response followed by six quadrature-pair Gabor
orientation-energy responses. The display maps are normalized independently so
that the structure in every orientation channel remains visible.
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.signal import fftconvolve


ROOT = Path(__file__).resolve().parent
ORIENTATIONS = range(0, 180, 30)
FILTER_SIGMA = 1.6
GABOR_WAVELENGTH = 3.2
WHITE_NOISE_SEED = 23


def gabor_kernel(
    theta_degrees,
    phase,
    sigma=FILTER_SIGMA,
    wavelength=GABOR_WAVELENGTH,
):
    radius = int(np.ceil(sigma * 4))
    axis = np.arange(-radius, radius + 1, dtype=np.float32)
    x, y = np.meshgrid(axis, axis)
    theta = np.deg2rad(theta_degrees)
    x_prime = x * np.cos(theta) + y * np.sin(theta)
    y_prime = -x * np.sin(theta) + y * np.cos(theta)
    envelope = np.exp(-(x_prime**2 + y_prime**2) / (2 * sigma**2))
    kernel = envelope * np.cos(2 * np.pi * x_prime / wavelength + phase)
    kernel -= kernel.mean()
    return kernel


def percentile_scale(values, percentile=99.7):
    scale = np.percentile(values, percentile)
    return np.clip(values / max(scale, 1e-8), 0, 1)


def hot_response(values):
    value = percentile_scale(values)
    red = np.clip(value * 3.0, 0, 1)
    green = np.clip(value * 3.0 - 1.0, 0, 1)
    blue = np.clip(value * 3.0 - 2.0, 0, 1)
    return Image.fromarray(np.uint8(np.dstack((red, green, blue)) * 255), "RGB")


def signed_response(values):
    scale = np.percentile(np.abs(values), 99.5)
    value = np.clip(values / max(scale, 1e-8), -1, 1)
    magnitude = np.abs(value)
    base = 0.08 + (1 - magnitude) * 0.84
    red = np.where(value >= 0, base + magnitude * (1 - base), base * (1 - magnitude))
    green = base * (1 - 0.55 * magnitude)
    blue = np.where(value < 0, base + magnitude * (1 - base), base * (1 - magnitude))
    return Image.fromarray(np.uint8(np.dstack((red, green, blue)) * 255), "RGB")


def orientation_energy(image):
    dog = gaussian_filter(image, FILTER_SIGMA / 2, mode="reflect") - gaussian_filter(
        image, FILTER_SIGMA, mode="reflect"
    )
    channels = []
    for theta in ORIENTATIONS:
        even = fftconvolve(dog, gabor_kernel(theta, 0), mode="same")
        odd = fftconvolve(dog, gabor_kernel(theta, np.pi / 2), mode="same")
        channels.append(even**2 + odd**2)
    return dog, channels, np.sum(channels, axis=0)


def grayscale_from_hot(image):
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    # In the black-red-yellow-white palette, (R + G + B) / 3 recovers the
    # normalized scalar response used to create the display color.
    value = np.clip(rgb.sum(axis=2) / 3, 0, 255)
    return Image.fromarray(np.uint8(value), "L")


def main():
    source = Image.open(ROOT / "before.jpeg").convert("L")
    image = np.asarray(source, dtype=np.float32) / 255.0

    # D = N_(sigma/2) - N_sigma. A 1.6 px display scale preserves the
    # fine contours visible in the supplied 512 px analysis output.
    dog, channels, _ = orientation_energy(image)
    signed_response(dog).save(ROOT / "wolf_dog.png", optimize=True)

    for theta, energy in zip(ORIENTATIONS, channels):
        hot_response(energy).save(ROOT / f"wolf_gabor_{theta:03d}.png", optimize=True)

    supplied_energy = Image.open(ROOT / "After.png")
    grayscale_from_hot(supplied_energy).save(
        ROOT / "wolf_energy_grayscale.png", optimize=True
    )

    rng = np.random.default_rng(WHITE_NOISE_SEED)
    noise = np.clip(rng.normal(0.5, 0.18, image.shape), 0, 1).astype(np.float32)
    Image.fromarray(np.uint8(noise * 255), "L").save(
        ROOT / "white_noise.png", optimize=True
    )
    _, _, noise_energy = orientation_energy(noise)
    hot_response(noise_energy).save(ROOT / "white_noise_energy.png", optimize=True)


if __name__ == "__main__":
    main()
