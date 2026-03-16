import { DivIcon, divIcon } from "leaflet";

const iconCache = new Map<string, DivIcon>();

function normalizeDeg(deg: number, step = 15) {
  const normalized = ((deg % 360) + 360) % 360;
  return Math.round(normalized / step) * step;
}

export function getTriangleIcon(color: string, deg: number, size = 10) {
  const roundedDeg = normalizeDeg(deg);
  const key = `triangle|${color}|${roundedDeg}|${size}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const h = Math.round(size * 1.15);
  const w = Math.round(size * 0.5);
  const icon = divIcon({
    className: "",
    html: `<div style='transform: rotate(${roundedDeg}deg); width:0;height:0;border-left:${w / 2}px solid transparent;border-right:${w / 2}px solid transparent;border-bottom:${h}px solid ${color};'></div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), Math.round(h * 0.75)],
  });
  iconCache.set(key, icon);
  return icon;
}

export function getPlaybackTriangleIcon(
  color: string,
  deg: number,
  size = 14,
  withCross = false,
  equilateral = false,
) {
  const roundedDeg = normalizeDeg(deg);
  const key = `playback-triangle|${color}|${roundedDeg}|${size}|${withCross ? 1 : 0}|${equilateral ? 1 : 0}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const h = equilateral ? Math.round(size * 0.95) : Math.round(size * 1.1);
  const w = equilateral ? Math.round(size * 1.1) : Math.round(size * 0.5);
  const tri = `<div style='transform: rotate(${roundedDeg}deg); width:0; height:0; border-left:${w / 2}px solid transparent; border-right:${w / 2}px solid transparent; border-bottom:${h}px solid ${color}; filter: drop-shadow(0 0 1px rgba(2,6,23,0.9));'></div>`;
  const html = withCross
    ? `<div style='position:relative;width:${size + 18}px;height:${size + 18}px;display:flex;align-items:center;justify-content:center;'>${tri}<div style='position:absolute;color:${color};opacity:0.98;font-size:${size + 22}px;font-weight:200;line-height:1;text-shadow:0 0 1px rgba(2,6,23,0.9);'>×</div></div>`
    : tri;
  const iconWidth = withCross ? size + 8 : size;
  const iconHeight = withCross ? size + 8 : Math.round(size * 1.17);

  const icon = divIcon({
    className: "",
    html,
    iconSize: [iconWidth, iconHeight],
    iconAnchor: withCross
      ? [Math.round(iconWidth / 2), Math.round(iconHeight / 2)]
      : [Math.round(iconWidth / 2), Math.round(iconHeight * 0.72)],
  });
  iconCache.set(key, icon);
  return icon;
}
