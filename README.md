# Ata Murat Kalkan — artist portfolio

This is a simple static website for GitHub Pages. There is no framework, database,
package manager, or build step.

The artwork catalogue is controlled by one file:

`data/artworks.json`

The website reads that file and creates all four galleries automatically. You do
not need to edit `index.html`, `style.css`, or `script.js` when changing artwork.

## Before publishing

The first version contains clearly marked replacement content. Replace:

- all placeholder artwork images and metadata;
- `images/portrait/portrait-placeholder.png`;
- the artist statement in `index.html`;
- `replace-me@example.com` in `index.html`;
- the Instagram placeholder in `index.html`, or remove it;
- `images/favicon/favicon-placeholder.png`;
- `images/social/social-preview-placeholder.png`.

Also update the portrait and social-image descriptions in the metadata near the
top of `index.html` when the real files are added.

## Important filename and JSON rules

- Keep filenames lowercase.
- Use hyphens instead of spaces: `red-fox-study.jpg`.
- Avoid spaces in filenames.
- Use straight quotation marks in JSON: `"title"`, not curly quotation marks.
- Keep commas valid. Every artwork object needs a comma after it except the last
  object in a section.
- Do not place a comma after the final object in a section.

If you are unsure whether the JSON is valid, paste the contents of
`data/artworks.json` into a trusted JSON validator before publishing.

## Replace an existing artwork image

There are two easy methods.

### Method 1: keep the same filename

1. Open the correct folder inside `images/`.
2. Delete the old image.
3. Upload the new image with exactly the same filename.
4. Commit the change.

Nothing in `artworks.json` needs to change.

### Method 2: use a new filename

1. Upload the new image to the correct folder.
2. Open `data/artworks.json`.
3. Find the artwork.
4. Change only its `"image"` value.

Example:

```json
"image": "images/animal-studies/red-fox-study.webp"
```

If the new image has different pixel dimensions, also update `"width"` and
`"height"`.

## Add a new artwork

1. Upload the image to the correct folder inside `images/`.
2. Open `data/artworks.json`.
3. Copy an existing artwork object from the correct section.
4. Paste the copy after another artwork object.
5. Change every value for the new work.
6. Make sure the `"id"` is unique.

Example:

```json
{
  "id": "red-fox-study",
  "title": "TITLE TO REPLACE",
  "year": "YEAR TO REPLACE",
  "medium": "MEDIUM TO REPLACE",
  "image": "images/animal-studies/red-fox-study.webp",
  "alt": "Describe what is visibly shown in this artwork",
  "size": "large",
  "width": 2000,
  "height": 1500
}
```

The width and height are the image's pixel dimensions. They help prevent the page
from moving while an image loads.

## Remove an artwork

1. Open `data/artworks.json`.
2. Delete the complete artwork object, from its opening `{` to its closing `}`.
3. Check the commas before and after the deleted object.
4. Optionally delete the unused image file.

Removing the object removes the artwork from the website.

## Reorder artworks

Move the complete artwork object up or down inside its section in
`data/artworks.json`.

The first object appears first. The order is never changed automatically.

Use the first position for the strongest work, then arrange the remaining objects
to create a balanced sequence of colour, scale, and image shape.

## Change title, year, or medium

Find the artwork in `data/artworks.json` and edit these values:

```json
"title": "Fox",
"year": "2026",
"medium": "Oil on paper"
```

Do not remove the quotation marks.

## Change the layout size

Edit the artwork's `"size"` value:

```json
"size": "large"
```

Only these values are accepted:

- `"large"`
- `"medium"`
- `"small"`

The size controls the artwork's width in the editorial layout. It never crops the
image.

## Move an artwork to another section

1. Cut the complete artwork object from its current section.
2. Paste it inside the destination section.
3. Update its image path if you also moved the image file.
4. Check all commas.

The four section names are:

```json
"animalStudies": [],
"experimentsInColour": [],
"lightAndShadowStudies": [],
"photography": []
```

An empty section is automatically hidden from the page and navigation.

## Replace the portrait

The simplest method is to replace:

`images/portrait/portrait-placeholder.png`

with a black-and-white portrait using the same filename. For a different filename,
change the portrait `src` near the About section in `index.html`, then update the
portrait URL in the structured data near the top of the same file.

The current placeholder is 800 × 1000 pixels. A portrait near that shape works
well.

## Change the artist statement

Open `index.html` and find:

`Artist statement placeholder — replace this text.`

Replace the placeholder paragraphs beneath it with the real statement. Remove the
replacement-label paragraph when finished.

## Change the email address

Open `index.html` and replace both appearances of:

`replace-me@example.com`

The first appearance is inside the `mailto:` link. The second is the visible
address. They should match.

## Add or remove Instagram

Open `index.html` and find:

```html
<p class="instagram-placeholder">
```

To add Instagram, replace the placeholder URL and visible text.

To remove Instagram, delete that complete `<p>...</p>` block.

## Replace the favicon

Replace:

`images/favicon/favicon-placeholder.png`

with a square PNG using the same filename. A 512 × 512 image is suitable.

If you use a different filename or format, update the favicon link near the top of
`index.html`.

## Replace the social preview image

Replace:

`images/social/social-preview-placeholder.png`

with an image that is 1200 × 630 pixels and uses the same filename.

Also replace its placeholder description in the Open Graph and Twitter metadata
near the top of `index.html`.

## Prepare artwork images

Recommended export settings:

- 1800–2400 pixels on the longest side;
- high-quality WebP or JPG;
- usually under approximately 1.5 MB per image;
- the sRGB colour space for predictable web display;
- an embedded colour profile when your image editor offers that option.

Do not upload print-resolution originals. The website needs viewing-quality files,
not production files. Avoid aggressive compression that damages colour or visible
paint texture.

## Preview the site locally

The gallery data cannot load reliably by double-clicking `index.html`. Preview it
through a small local web server instead.

On macOS:

1. Open Terminal.
2. Type `cd `, including the space.
3. Drag the website folder into the Terminal window.
4. Press Return.
5. Run:

```text
python3 -m http.server 8000
```

6. Open `http://localhost:8000` in a browser.
7. Press Control+C in Terminal when finished.

This does not install a framework or change the website.

## Publish changes with GitHub Pages

When this repository is named `atamuratkalkan.github.io`, GitHub Pages can publish
the files directly.

1. Upload or edit the files on GitHub.
2. Commit the changes to the publishing branch.
3. GitHub Pages rebuilds the website automatically.
4. Wait a few minutes, then refresh the site.

In the repository settings, Pages should publish from the repository root on the
chosen branch. The `CNAME` file connects the intended custom domain:

`atamuratkalkan.art`

DNS records still need to be configured separately with the domain provider.

## If an image does not appear

Check:

- the filename and folder match the `"image"` path exactly;
- capitalization matches exactly;
- the filename has no spaces;
- the JSON uses straight quotation marks;
- commas in `data/artworks.json` are valid.

A single broken image displays a restrained warning in its place and does not
break the rest of the gallery.
