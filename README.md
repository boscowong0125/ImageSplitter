# Image Splitter

A simple, client-side web app that splits an image into equal parts — horizontally (columns), vertically (rows), or as a grid — and exports every part as a **lossless PNG**.

Example: a 3840×2160 image split into 3 parts horizontally gives three 1280×2160 images.

## Features

- Upload by drag & drop, file picker, or paste (Ctrl+V). Handles 4K and larger.
- Horizontal, vertical, or grid splitting (up to 100 per axis, 400 parts total).
- Live split guides over the source image, plus a preview of every part.
- Click a part to view it full size and step through parts with the arrow keys.
- Download single parts or all parts as one ZIP.
- Custom file name prefix (`name_1.png`, or `name_r1_c2.png` for grids).
- If the size isn't evenly divisible, the extra pixels are spread so parts differ by at most 1px. No pixels are dropped.
- Pixels are copied exactly (no resampling, no color conversion). Transparency is preserved.
- Works offline with no dependencies. Your image never leaves your browser.
- Light and dark themes follow your system setting.

## Hosting on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
4. The site will be live at `https://<username>.github.io/ImageSplitter/`.

## Local use

Open `index.html` in a browser. No build step is needed.
