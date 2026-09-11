/**
 * The region crop behind Assert Map Changed. ONE definition, two callers that can't share a
 * runtime: the recorder imports it directly, and scriptGenerator stringifies it into the generated
 * Playwright script (which runs as its own node process). So, like mapHelpers, it must be fully
 * self-contained.
 *
 * PNG is passed IN rather than required inside: a bundler rewrites `require('pngjs')` into its own
 * internal alias, which then doesn't exist in the generated script — the function has to survive
 * .toString() with no free references at all.
 */

/**
 * Crop a PNG buffer to one of nine regions. Cropped from the DECODED image rather than through a
 * screenshot clip: image pixels already account for the device pixel ratio, and there is no
 * viewport/scroll offset to get wrong. Returns a pngjs PNG; an unknown region (or 'whole map')
 * returns the whole image.
 */
export function cropRegion(PNG, buf, region, boxW, boxH) {
  const CELLS = {
    'top-left': [0, 0], 'top': [1, 0], 'top-right': [2, 0],
    'left': [0, 1], 'centre': [1, 1], 'right': [2, 1],
    'bottom-left': [0, 2], 'bottom': [1, 2], 'bottom-right': [2, 2]
  }
  const src = PNG.sync.read(buf)
  const cell = CELLS[region]
  if (!cell) return src
  // A FIXED box beats a fraction of the element: OpenLayers holds the view centre and the
  // resolution across a resize, so a fixed-size crop is the same ground at the same scale even
  // when a sidebar makes the map narrower — a fractional cell would change dimensions and make
  // the two captures incomparable.
  const w = Math.max(1, Math.min(boxW > 0 ? boxW : Math.round(src.width / 3), src.width))
  const h = Math.max(1, Math.min(boxH > 0 ? boxH : Math.round(src.height / 3), src.height))
  const cx = src.width * (cell[0] * 2 + 1) / 6, cy = src.height * (cell[1] * 2 + 1) / 6
  const x = Math.round(Math.max(0, Math.min(cx - w / 2, src.width - w)))
  const y = Math.round(Math.max(0, Math.min(cy - h / 2, src.height - h)))
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(src, out, x, y, w, h, 0, 0)
  return out
}
