export const ACTION_DEFS = {
  // --- Navigation ---
  navigate: {
    label: 'Navigate', category: 'Navigation',
    summary: p => p.url,
    params: [
      { key: 'url', label: 'URL (relative or absolute)', placeholder: '/login or https://...' },
      { key: 'waitUntil', label: 'Wait until', type: 'select',
        options: ['domcontentloaded', 'load', 'networkidle', 'commit'], default: 'domcontentloaded' },
      { key: 'navTimeout', label: 'Nav timeout (ms)', type: 'number', placeholder: 'blank = profile default (e.g. 30000)' }
    ]
  },
  reload: { label: 'Reload Page', category: 'Navigation', params: [] },
  goBack: { label: 'Go Back', category: 'Navigation', params: [] },
  goForward: { label: 'Go Forward', category: 'Navigation', params: [] },
  waitForUrl: {
    label: 'Wait for URL', category: 'Navigation',
    summary: p => p.pattern,
    params: [{ key: 'pattern', label: 'URL Pattern (string or regex)', placeholder: '/dashboard' }]
  },

  // --- Interaction ---
  click: {
    label: 'Click', category: 'Interaction',
    summary: p => p.selector,
    params: [
      { key: 'selector', label: 'Selector (CSS or text)', placeholder: '#submit-btn or text=Login' },
      { key: 'selector2', label: 'Alt Selector (fallback)', placeholder: 'button.login-btn (optional)' },
      { key: 'waitBefore', label: 'Wait before click (ms)', placeholder: '0 — e.g. 500 for modal animations', type: 'number' },
      { key: 'force', label: 'Force click (skip visible/stable checks)', type: 'boolean' },
      { key: 'dispatch', label: 'Dispatch DOM event (stubborn JS toggles / hidden menus)', type: 'boolean' }
    ]
  },
  dblclick: {
    label: 'Double Click', category: 'Interaction',
    summary: p => p.selector,
    params: [
      { key: 'selector', label: 'Selector', placeholder: '.item' },
      { key: 'selector2', label: 'Alt Selector (fallback)', placeholder: 'optional fallback' },
      { key: 'waitBefore', label: 'Wait before click (ms)', placeholder: '0 — e.g. 500 for modal animations', type: 'number' },
      { key: 'force', label: 'Force click (skip visible/stable checks)', type: 'boolean' },
      { key: 'dispatch', label: 'Dispatch DOM event (stubborn JS toggles / hidden menus)', type: 'boolean' }
    ]
  },
  rightClick: {
    label: 'Right Click', category: 'Interaction',
    summary: p => p.selector,
    params: [
      { key: 'selector', label: 'Selector', placeholder: '.item' },
      { key: 'selector2', label: 'Alt Selector (fallback)', placeholder: 'optional fallback' },
      { key: 'waitBefore', label: 'Wait before click (ms)', placeholder: '0 — e.g. 500 for modal animations', type: 'number' },
      { key: 'force', label: 'Force click (skip visible/stable checks)', type: 'boolean' }
    ]
  },
  hover: {
    label: 'Hover', category: 'Interaction',
    summary: p => p.selector,
    params: [
      { key: 'selector', label: 'Selector', placeholder: '.menu-item' },
      { key: 'selector2', label: 'Alt Selector (fallback)', placeholder: 'optional fallback' }
    ]
  },
  focus: {
    label: 'Focus', category: 'Interaction',
    params: [{ key: 'selector', label: 'Selector', placeholder: '#input-field' }]
  },
  selectOption: {
    label: 'Select Option', category: 'Interaction',
    summary: p => `${p.selector} → ${p.value}`,
    params: [
      { key: 'selector', label: 'Selector', placeholder: 'select#region' },
      { key: 'value', label: 'Option Value or Label', placeholder: 'NCR' }
    ]
  },
  fill: {
    label: 'Fill Input', category: 'Interaction',
    summary: p => `${p.selector} = "${p.value}"`,
    params: [
      { key: 'selector', label: 'Selector', placeholder: '#username' },
      { key: 'value', label: 'Value to fill', placeholder: 'testuser@example.com' }
    ]
  },
  type: {
    label: 'Type (with delay)', category: 'Interaction',
    params: [
      { key: 'selector', label: 'Selector', placeholder: '#search' },
      { key: 'value', label: 'Text to type', placeholder: 'search query' },
      { key: 'delay', label: 'Delay between keystrokes (ms)', type: 'number', placeholder: '50' }
    ]
  },
  clearInput: {
    label: 'Clear Input', category: 'Interaction',
    params: [{ key: 'selector', label: 'Selector', placeholder: '#input' }]
  },
  pressKey: {
    label: 'Press Key', category: 'Interaction',
    summary: p => `${p.key} on ${p.selector || 'body'}`,
    params: [
      { key: 'selector', label: 'Selector (leave blank for body)', placeholder: '#input (optional)' },
      { key: 'key', label: 'Key', placeholder: 'Enter, Tab, Escape, ArrowDown…' }
    ]
  },
  uploadFile: {
    label: 'Upload File', category: 'Interaction',
    summary: p => p.filePath ? `${p.trigger ? `via ${p.trigger}` : p.selector} ← ${p.filePath}` : (p.trigger || p.selector),
    params: [
      { key: 'selector', label: 'File input selector — the hidden <input type=file>, NOT the read-only display box', placeholder: 'input[type=file]' },
      { key: 'filePath', label: 'Absolute File Path', placeholder: 'C:\\Users\\user\\file.csv' },
      { key: 'trigger', label: 'OR — Upload/Browse button that opens the file dialog (use when there is no file input to target)', placeholder: '#BIMSBUfileUpload (optional)' }
    ]
  },
  dragAndDrop: {
    label: 'Drag & Drop', category: 'Interaction',
    params: [
      { key: 'source', label: 'Source Selector', placeholder: '.drag-item' },
      { key: 'target', label: 'Target Selector', placeholder: '.drop-zone' }
    ]
  },

  // --- Mouse / Map ---
  clickAt: {
    label: 'Click at Position', category: 'Mouse',
    summary: p => `${p.selector || 'page'} @ (${p.x || 0}, ${p.y || 0})`,
    params: [
      { key: 'selector', label: 'Selector (blank = whole page)', placeholder: 'canvas#map (optional)' },
      { key: 'x', label: 'X — px from element left', type: 'number', placeholder: '0' },
      { key: 'y', label: 'Y — px from element top', type: 'number', placeholder: '0' }
    ]
  },
  dragByOffset: {
    label: 'Drag by Offset', category: 'Mouse',
    summary: p => `${p.selector || '?'} by (${p.dx || 0}, ${p.dy || 0})`,
    params: [
      { key: 'selector', label: 'Handle to grab', placeholder: '.modal-header' },
      { key: 'dx', label: 'Move X — px (− = left)', type: 'number', placeholder: '-300' },
      { key: 'dy', label: 'Move Y — px (− = up)', type: 'number', placeholder: '0' },
      { key: 'x', label: 'Grab X within element (blank = center)', type: 'number', placeholder: 'center' },
      { key: 'y', label: 'Grab Y within element (blank = center)', type: 'number', placeholder: 'center' }
    ]
  },
  zoom: {
    label: 'Zoom / Scroll Wheel', category: 'Mouse',
    summary: p => `${p.selector || 'page'} ${(Number(p.deltaY) || -100) < 0 ? 'in' : 'out'} ×${p.times || 1}`,
    params: [
      { key: 'selector', label: 'Hover target (the map)', placeholder: 'canvas#map' },
      { key: 'deltaY', label: 'Wheel delta (− = zoom in)', type: 'number', placeholder: '-100' },
      { key: 'times', label: 'Repeat', type: 'number', placeholder: '1' }
    ]
  },
  // GIS map actions — talk to the live OpenLayers map (window.map) instead of guessing
  // pixels. pinCoordinate projects an exact lat/lng to its pixel and clicks it; mapZoom
  // drives the view API so it zooms about the CENTRE, not the cursor (unlike a scroll wheel).
  pinCoordinate: {
    label: 'Pin Coordinate (lat/lng)', category: 'Mouse',
    summary: p => `${p.lat ?? '?'}, ${p.lng ?? '?'}${p.zoom ? ` @ z${p.zoom}` : ''}`,
    params: [
      { key: 'lat', label: 'Latitude', type: 'number', placeholder: '14.3294' },
      { key: 'lng', label: 'Longitude', type: 'number', placeholder: '120.9367' },
      { key: 'zoom', label: 'Zoom level when recentering (blank = keep current)', type: 'number', placeholder: '18' },
      { key: 'recenter', label: 'Recenter map to this coordinate first (recommended)', type: 'boolean', default: true },
      { key: 'mapVar', label: 'Map global name (advanced)', placeholder: 'map' }
    ]
  },
  mapZoom: {
    label: 'Map Zoom (level)', category: 'Mouse',
    summary: p => (p.zoom != null && p.zoom !== '') ? `level ${p.zoom}` : `${Number(p.delta) >= 0 ? '+' : ''}${p.delta || 0} step`,
    params: [
      { key: 'zoom', label: 'Zoom to level (absolute, e.g. 18)', type: 'number', placeholder: '18' },
      { key: 'delta', label: 'OR step relative (− = out)', type: 'number', placeholder: '+1 / -1' },
      { key: 'lat', label: 'Anchor latitude (optional — recenters here)', type: 'number', placeholder: '14.3294' },
      { key: 'lng', label: 'Anchor longitude (optional)', type: 'number', placeholder: '120.9367' },
      { key: 'mapVar', label: 'Map global name (advanced)', placeholder: 'map' }
    ]
  },

  // --- Assertions ---
  assertVisible: {
    label: 'Assert Visible', category: 'Assertions',
    summary: p => p.selector,
    params: [{ key: 'selector', label: 'Selector', placeholder: '.success-message' }]
  },
  assertHidden: {
    label: 'Assert Hidden', category: 'Assertions',
    params: [{ key: 'selector', label: 'Selector', placeholder: '.error-banner' }]
  },
  assertText: {
    label: 'Assert Text', category: 'Assertions',
    summary: p => `"${p.text}" in ${p.selector}`,
    params: [
      { key: 'selector', label: 'Selector', placeholder: 'h1' },
      { key: 'text', label: 'Expected Text', placeholder: 'Welcome back' },
      { key: 'exact', label: 'Exact match?', type: 'boolean' }
    ]
  },
  assertValue: {
    label: 'Assert Input Value', category: 'Assertions',
    params: [
      { key: 'selector', label: 'Selector', placeholder: '#username' },
      { key: 'value', label: 'Expected Value', placeholder: 'admin' }
    ]
  },
  assertUrl: {
    label: 'Assert URL', category: 'Assertions',
    summary: p => p.pattern,
    params: [{ key: 'pattern', label: 'URL Pattern', placeholder: '/dashboard' }]
  },
  assertTitle: {
    label: 'Assert Page Title', category: 'Assertions',
    params: [{ key: 'pattern', label: 'Title Pattern', placeholder: 'My App' }]
  },
  assertEnabled: {
    label: 'Assert Enabled/Disabled', category: 'Assertions',
    params: [
      { key: 'selector', label: 'Selector', placeholder: '#submit' },
      { key: 'enabled', label: 'Should be enabled?', type: 'boolean' }
    ]
  },
  assertChecked: {
    label: 'Assert Checked', category: 'Assertions',
    params: [
      { key: 'selector', label: 'Selector', placeholder: '#agree-checkbox' },
      { key: 'checked', label: 'Should be checked?', type: 'boolean' }
    ]
  },

  // --- Waits ---
  waitForSelector: {
    label: 'Wait for Element', category: 'Waits',
    summary: p => p.selector,
    params: [
      { key: 'selector', label: 'Selector', placeholder: '.loading-spinner' },
      { key: 'state', label: 'State', type: 'select', options: ['visible', 'hidden', 'attached', 'detached'], default: 'visible' }
    ]
  },
  waitForTimeout: {
    label: 'Wait (ms)', category: 'Waits',
    summary: p => `${p.ms}ms`,
    params: [{ key: 'ms', label: 'Milliseconds', type: 'number', placeholder: '2000' }]
  },
  waitForNetworkIdle: {
    label: 'Wait for Network Idle', category: 'Waits',
    params: []
  },

  // --- Group / Loop ---
  // groupStart..groupEnd wrap a range of steps into a named, collapsible block. If "repeat"
  // is on, the body repeats once per data set in the chosen collection+group (each iteration
  // resolving that set's {{tokens}}). Usually created via "⊞ Group" on selected steps.
  // Rendered specially in CanvasStep. (loopStart/loopEnd kept as repeat-group aliases.)
  groupStart: {
    label: 'Group start', category: 'Flow',
    summary: p => (p.label || 'Group') + (p.repeat ? ` · repeats ${p.group || 'positive'} sets` : ''),
    params: [
      { key: 'repeat', label: 'Repeat for each data set', type: 'boolean' },
      { key: 'collectionId', label: 'Collection', placeholder: 'pick a data collection' },
      { key: 'group', label: 'Group', type: 'select', options: ['positive', 'negative', 'edge', 'all'], default: 'positive' }
    ]
  },
  // groupEnd is hidden from the palette (groups are added as a balanced pair via groupStart
  // or the "⊞ Group" button) so a stray, un-paired end can't be created from the menu.
  groupEnd: { label: 'Group end', category: 'Flow', hidden: true, params: [] },

  // --- Util ---
  screenshot: {
    label: 'Take Screenshot', category: 'Util',
    params: [
      { key: 'path', label: 'Save Path', placeholder: 'C:\\screenshots\\step.png' },
      { key: 'fullPage', label: 'Full page?', type: 'boolean' }
    ]
  },
  executeScript: {
    label: 'Execute JS', category: 'Util',
    params: [{ key: 'script', label: 'JavaScript Expression', type: 'textarea', placeholder: '() => document.title' }]
  },

  // --- Notes ---
  // A free-text note for human readers. Does nothing at run time (emits a // comment line).
  comment: {
    label: 'Comment', category: 'Util',
    summary: p => p.text || '',
    params: [{ key: 'text', label: 'Note', type: 'textarea', placeholder: 'Note for readers — ignored when running' }]
  }
}

export const ACTION_CATEGORIES = ['Navigation', 'Interaction', 'Mouse', 'Assertions', 'Waits', 'Flow', 'Util']

export const ACTIONS_BY_CATEGORY = ACTION_CATEGORIES.reduce((acc, cat) => {
  acc[cat] = Object.entries(ACTION_DEFS)
    .filter(([, def]) => def.category === cat && !def.hidden)
    .map(([key, def]) => ({ key, ...def }))
  return acc
}, {})
