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
    params: [
      { key: 'selector', label: 'File Input Selector', placeholder: 'input[type=file]' },
      { key: 'filePath', label: 'Absolute File Path', placeholder: 'C:\\Users\\user\\file.pdf' }
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
  }
}

export const ACTION_CATEGORIES = ['Navigation', 'Interaction', 'Mouse', 'Assertions', 'Waits', 'Util']

export const ACTIONS_BY_CATEGORY = ACTION_CATEGORIES.reduce((acc, cat) => {
  acc[cat] = Object.entries(ACTION_DEFS)
    .filter(([, def]) => def.category === cat)
    .map(([key, def]) => ({ key, ...def }))
  return acc
}, {})
