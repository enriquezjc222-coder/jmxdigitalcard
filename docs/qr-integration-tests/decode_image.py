#!/usr/bin/env python3
"""Decode QR images with two independent OpenCV decoders. Prints JSON {file: [opencv, aruco]}.
Images are padded with white so the quiet zone never touches the image border."""
import json, sys, cv2
out = {}
for f in sys.argv[1:]:
    img = cv2.imread(f, cv2.IMREAD_COLOR)
    img = cv2.copyMakeBorder(img, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    res = []
    for d in (cv2.QRCodeDetector(), cv2.QRCodeDetectorAruco()):
        try: res.append(d.detectAndDecode(img)[0] or '')
        except cv2.error: res.append('')
    # small renders (e.g. 160 px @1x) are also tried upscaled 2x, as a phone camera would see them larger
    if not any(res):
        big = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        res = [d.detectAndDecode(big)[0] or '' for d in (cv2.QRCodeDetector(), cv2.QRCodeDetectorAruco())]
    out[f] = res
print(json.dumps(out))
