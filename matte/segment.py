"""segment.py — subject matting for Sharimie's "text behind subject" effect.

Loads a U2-Net ONNX model once and turns every frame in an input folder into a
grayscale mask (white = foreground subject) in an output folder. The Node side
extracts frames with ffmpeg, calls this, then composites text BETWEEN the
background and the masked subject.

Usage: python segment.py <frames_dir> <masks_dir> <model_path>
CPU only; designed to be cheap (model runs at 320x320 then the mask is upscaled).
"""
import sys
import os
import glob
import numpy as np
from PIL import Image
import onnxruntime as ort

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
SIZE = 320


def preprocess(img):
    im = img.convert("RGB").resize((SIZE, SIZE), Image.BILINEAR)
    a = np.array(im).astype(np.float32)
    mx = a.max()
    if mx > 0:
        a = a / mx
    a = (a - MEAN) / STD
    a = a.transpose(2, 0, 1)[None, ...]
    return np.ascontiguousarray(a, dtype=np.float32)


def postprocess(pred, out_size):
    d = pred
    while d.ndim > 2:
        d = d[0]
    mi, ma = float(d.min()), float(d.max())
    d = (d - mi) / (ma - mi + 1e-8)
    # Gentle confidence lift so the subject body is solid while edges stay soft.
    d = np.clip(d, 0, 1) ** 0.7
    return Image.fromarray((d * 255).astype(np.uint8)).resize(out_size, Image.BILINEAR)


def main():
    if len(sys.argv) < 4:
        print("usage: segment.py <frames_dir> <masks_dir> <model_path>", file=sys.stderr)
        return 2
    frames_dir, masks_dir, model_path = sys.argv[1], sys.argv[2], sys.argv[3]
    if not os.path.isfile(model_path):
        print("model not found: " + model_path, file=sys.stderr)
        return 3
    os.makedirs(masks_dir, exist_ok=True)
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    iname = sess.get_inputs()[0].name
    frames = sorted(glob.glob(os.path.join(frames_dir, "*.png")))
    if not frames:
        print("no frames in " + frames_dir, file=sys.stderr)
        return 4
    for i, f in enumerate(frames):
        img = Image.open(f)
        out = sess.run(None, {iname: preprocess(img)})[0]
        mask = postprocess(out, img.size)
        mask.save(os.path.join(masks_dir, os.path.basename(f)))
        if i % 5 == 0:
            print("frame %d/%d" % (i + 1, len(frames)), flush=True)
    print("done %d frames" % len(frames), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
