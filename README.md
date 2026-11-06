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
- Light and dark themes. The sun/moon button switches between them and remembers your choice. Until you pick one, the page follows your system setting.

### Mobile (iOS & Android)

- Responsive layout with large touch targets, −/+ steppers and a numeric keypad for part counts.
- **Save all to Photos** (iOS) opens the share sheet. Tap “Save Images” to add the parts to the Photos app. Websites can't write to the photo library directly, so this one confirmation tap is required by iOS.
- **Save all to Gallery** (Android) saves each part as its own PNG. Gallery apps (Google Photos, Samsung Gallery) show them in the “Download” album. A **Share…** button is available in the full-screen viewer.
- On phones the save button is the only download option. The ZIP download is desktop only, because ZIP files don't appear in photo apps.
- Full-screen viewer with swipe left/right between parts.
- Previews are built from a downscaled copy, and full-resolution parts are created one at a time only when exporting. This keeps memory use low enough for iOS Safari's canvas limits.
- Respects notches and safe areas, and inputs don't trigger iOS auto-zoom.

## Hosting on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
4. The site will be live at `https://<username>.github.io/ImageSplitter/`.

## Local use

Open `index.html` in a browser. No build step is needed.
