// Mobile-view emulation, shared by the run (scriptGenerator) and the interactive tools
// (browserSession). A profile flagged `mobile` launches the browser with a phone viewport +
// mobile user-agent + touch, so a web app that only renders in mobile view works.
//
// Firefox doesn't support isMobile / hasTouch / deviceScaleFactor as context options (Playwright
// throws), so it gets viewport + UA only — still narrow, still a mobile UA. Chromium/WebKit get
// full device emulation.

export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

// Extra newContext / launchPersistentContext options for mobile emulation, or {} when off.
export function mobileContextOptions(browser, mobile) {
  if (!mobile) return {}
  const base = { viewport: { width: 390, height: 844 }, userAgent: MOBILE_UA }
  if (browser === 'firefox') return base
  return { ...base, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
}
