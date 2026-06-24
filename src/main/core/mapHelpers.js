/**
 * Page-context helpers for GIS maps (OpenLayers). Like dragHelpers, these run INSIDE the
 * page via page.evaluate — they're stringified into the generated script and imported
 * directly by the replay path, so the two stay in lockstep.
 *
 * Why these exist: clicking a map by guessed pixel is fragile (lands in water, off-screen,
 * wrong at a different zoom). Instead we borrow the map's own projection to turn an exact
 * lat/lng into the precise pixel, then click that. Zoom is driven through the view API so it
 * zooms about the map CENTRE deterministically — not toward the cursor like a scroll wheel.
 *
 * Assumes the live map is reachable as window[mapVar] (default "map"). Works for any view
 * projection: EPSG:4326 is used as-is, EPSG:3857 (and others) go through ol.proj.fromLonLat
 * when the ol global exists, else an inline Web-Mercator transform as a last resort.
 *
 * IMPORTANT: each exported function MUST be self-contained — page.evaluate / .toString()
 * serialize only the one function, so no module-scope helpers can be referenced here.
 */

/**
 * Pin an exact lat/lng. Optionally recenters (and zooms) the view there first so the point
 * is guaranteed on-screen, then returns the precise page pixel for a real mouse click.
 * Returns { pageX, pageY, localX, localY, inView, zoom } or { error }.
 */
export async function mapPickPixel({ mapVar = 'map', lon, lat, zoom = null, recenter = true, settleMs = 3000 }) {
  const map = window[mapVar]
  if (!map || typeof map.getView !== 'function' || typeof map.getPixelFromCoordinate !== 'function') {
    return { error: `window.${mapVar} is not an OpenLayers map — the global may be named differently, or the map isn't initialised yet` }
  }
  const view = map.getView()

  // WGS84 [lon, lat] -> the view's own projection.
  const code = view.getProjection().getCode()
  let coord
  if (code === 'EPSG:4326' || code === 'CRS:84') {
    coord = [lon, lat]
  } else if (window.ol && window.ol.proj && window.ol.proj.fromLonLat) {
    coord = window.ol.proj.fromLonLat([lon, lat], code)
  } else {
    const R = 6378137
    coord = [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))]
  }

  if (recenter) {
    view.setCenter(coord)
    if (zoom !== null && zoom !== undefined && !Number.isNaN(Number(zoom))) view.setZoom(Number(zoom))
    // Wait for one painted frame so getPixelFromCoordinate uses the fresh transform. Never
    // hangs: the timeout resolves it even if rendercomplete never fires.
    await new Promise((resolve) => {
      let done = false
      const finish = () => { if (!done) { done = true; resolve() } }
      map.once('rendercomplete', finish)
      map.render()
      setTimeout(finish, settleMs > 0 ? settleMs : 3000)
    })
  }

  const size = map.getSize()
  if (!size) return { error: 'map size unavailable — the map is not attached to the DOM yet' }
  const pixel = map.getPixelFromCoordinate(coord)
  if (!pixel) return { error: 'getPixelFromCoordinate returned null — the view is not initialised yet' }

  const rect = map.getViewport().getBoundingClientRect()
  const inView = pixel[0] >= 0 && pixel[1] >= 0 && pixel[0] <= size[0] && pixel[1] <= size[1]
  return {
    pageX: rect.left + pixel[0], pageY: rect.top + pixel[1],
    localX: pixel[0], localY: pixel[1],
    inView, zoom: view.getZoom()
  }
}

/**
 * Set the map zoom through the view API — zooms about the CENTRE, not the cursor, so it's
 * deterministic (unlike a scroll wheel). `zoom` sets an absolute level; otherwise `delta`
 * steps relative to the current level. Optionally recenters on a lat/lng first to anchor it.
 * Returns { zoom } or { error }.
 */
export async function mapSetZoom({ mapVar = 'map', zoom = null, delta = null, lon = null, lat = null, settleMs = 3000 }) {
  const map = window[mapVar]
  if (!map || typeof map.getView !== 'function') {
    return { error: `window.${mapVar} is not an OpenLayers map — the global may be named differently, or the map isn't initialised yet` }
  }
  const view = map.getView()

  if (lon !== null && lat !== null && !Number.isNaN(Number(lon)) && !Number.isNaN(Number(lat))) {
    const code = view.getProjection().getCode()
    let coord
    if (code === 'EPSG:4326' || code === 'CRS:84') {
      coord = [Number(lon), Number(lat)]
    } else if (window.ol && window.ol.proj && window.ol.proj.fromLonLat) {
      coord = window.ol.proj.fromLonLat([Number(lon), Number(lat)], code)
    } else {
      const R = 6378137
      coord = [R * Number(lon) * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + (Number(lat) * Math.PI / 180) / 2))]
    }
    view.setCenter(coord)
  }

  if (zoom !== null && zoom !== undefined && !Number.isNaN(Number(zoom))) {
    view.setZoom(Number(zoom))
  } else if (delta !== null && delta !== undefined && !Number.isNaN(Number(delta))) {
    view.setZoom((view.getZoom() || 0) + Number(delta))
  } else {
    return { error: 'Map zoom needs either an absolute level or a relative step' }
  }

  await new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    map.once('rendercomplete', finish)
    map.render()
    setTimeout(finish, settleMs > 0 ? settleMs : 3000)
  })
  return { zoom: view.getZoom() }
}
