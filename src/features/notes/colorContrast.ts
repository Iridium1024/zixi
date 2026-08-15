function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function rgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundRgb = rgb(foreground)
  const backgroundRgb = rgb(background)
  if (!foregroundRgb || !backgroundRgb) return 1
  const luminance = ([red, green, blue]: [number, number, number]) =>
    0.2126 * channelLuminance(red)
    + 0.7152 * channelLuminance(green)
    + 0.0722 * channelLuminance(blue)
  const light = Math.max(luminance(foregroundRgb), luminance(backgroundRgb))
  const dark = Math.min(luminance(foregroundRgb), luminance(backgroundRgb))
  return (light + 0.05) / (dark + 0.05)
}
