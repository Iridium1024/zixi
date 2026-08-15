import { readFile, writeFile } from 'node:fs/promises'

const iconFiles = [
  [16, 'src-tauri/icons/16x16.png'],
  [24, 'src-tauri/icons/24x24.png'],
  [32, 'src-tauri/icons/32x32.png'],
  [48, 'src-tauri/icons/48x48.png'],
  [64, 'src-tauri/icons/64x64.png'],
  [128, 'src-tauri/icons/128x128.png'],
  [256, 'src-tauri/icons/128x128@2x.png'],
]

const images = await Promise.all(iconFiles.map(async ([size, file]) => {
  const bytes = await readFile(file)
  if (bytes.toString('ascii', 1, 4) !== 'PNG' || bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
    throw new Error(`${file} 不是预期的 ${size}×${size} PNG`)
  }
  return { size, bytes }
}))

const directorySize = 6 + images.length * 16
const header = Buffer.alloc(directorySize)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)

let dataOffset = directorySize
images.forEach(({ size, bytes }, index) => {
  const entryOffset = 6 + index * 16
  header.writeUInt8(size === 256 ? 0 : size, entryOffset)
  header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
  header.writeUInt8(0, entryOffset + 2)
  header.writeUInt8(0, entryOffset + 3)
  header.writeUInt16LE(1, entryOffset + 4)
  header.writeUInt16LE(32, entryOffset + 6)
  header.writeUInt32LE(bytes.length, entryOffset + 8)
  header.writeUInt32LE(dataOffset, entryOffset + 12)
  dataOffset += bytes.length
})

await writeFile('src-tauri/icons/icon.ico', Buffer.concat([header, ...images.map(({ bytes }) => bytes)]))
console.log(`icon.ico 已组合 ${images.map(({ size }) => `${size}px`).join('、')} 七个透明 PNG 帧`)
