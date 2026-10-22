// Schlichte Linien-Icons, 16 px, Strichstärke 1.6.

const svg = (d: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

export const I = {
  folder: svg('<path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z"/>'),
  zip: svg('<path d="M4 2h5l3 3v9H4z"/><path d="M7 4v1M7 6.5v1M7 9v1"/>'),
  rotL: svg('<path d="M3 8a5 5 0 1 0 1.5-3.5"/><path d="M3 2.5V5h2.5"/>'),
  rotR: svg('<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5V5h-2.5"/>'),
  mirror: svg('<path d="M8 2v12"/><path d="M5.5 4.5 2.5 8l3 3.5zM10.5 4.5l3 3.5-3 3.5z"/>'),
  up: svg('<path d="M8 13V3M4 7l4-4 4 4"/>'),
  down: svg('<path d="M8 3v10M4 9l4 4 4-4"/>'),
  left: svg('<path d="M13 8H3M7 4 3 8l4 4"/>'),
  right: svg('<path d="M3 8h10M9 4l4 4-4 4"/>'),
  trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'),
  play: svg('<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M5 3.5v9M11 3.5v9"/>'),
  prev: svg('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
  next: svg('<path d="M6 3.5 10.5 8 6 12.5"/>'),
  sun: svg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>'),
  moon: svg('<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  minus: svg('<path d="M3 8h10"/>'),
  target: svg('<circle cx="8" cy="8" r="4.5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>'),
  download: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>'),
  rect: svg('<rect x="2.5" y="3.5" width="11" height="9" rx="1" stroke-dasharray="2.2 1.6"/>'),
  fly: svg('<path d="M2 9.5 14 3l-3.5 11-2.5-4.5z"/><path d="m8 9.5 6-6.5"/>'),
  home: svg('<path d="M2.5 7.5 8 3l5.5 4.5"/><path d="M4 6.5V13h8V6.5"/>'),
  expand: svg('<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/>'),
  shrink: svg('<path d="M13 7H9V3M3 9h4v4M9 7l4.5-4.5M7 9l-4.5 4.5"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  cube: svg('<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>'),
}
