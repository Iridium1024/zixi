const IMAGE_PIXEL_LIMIT: u64 = 40_000_000;
const IMAGE_EDGE_LIMIT: u32 = 10_000;

pub(crate) fn extension_matches(format: &str, extension: &str) -> bool {
    if format == "jpeg" {
        extension == "jpg" || extension == "jpeg"
    } else {
        format == extension
    }
}

fn u24_le(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

fn range_fits(offset: usize, length: usize, total: usize) -> bool {
    offset.checked_add(length).is_some_and(|end| end <= total)
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return None;
    }

    let mut cursor = 8usize;
    let mut dimensions = None;
    let mut chunk_index = 0usize;
    while range_fits(cursor, 12, bytes.len()) {
        let chunk_length = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().ok()?) as usize;
        let chunk_end = cursor.checked_add(12)?.checked_add(chunk_length)?;
        if chunk_end > bytes.len() {
            return None;
        }
        let chunk_kind = &bytes[cursor + 4..cursor + 8];
        if chunk_index == 0 {
            if chunk_kind != b"IHDR" || chunk_length != 13 {
                return None;
            }
            dimensions = Some((
                u32::from_be_bytes(bytes[cursor + 8..cursor + 12].try_into().ok()?),
                u32::from_be_bytes(bytes[cursor + 12..cursor + 16].try_into().ok()?),
            ));
        } else if chunk_kind == b"IHDR" {
            return None;
        }

        cursor = chunk_end;
        chunk_index += 1;
        if chunk_kind == b"IEND" {
            return (chunk_length == 0 && cursor == bytes.len())
                .then_some(dimensions)
                .flatten();
        }
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || !bytes.starts_with(&[0xff, 0xd8, 0xff]) || !bytes.ends_with(&[0xff, 0xd9])
    {
        return None;
    }
    let mut cursor = 2usize;
    while cursor + 8 < bytes.len() {
        if bytes[cursor] != 0xff {
            cursor += 1;
            continue;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if marker == 0xd8 || marker == 0xd9 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = u16::from_be_bytes([*bytes.get(cursor)?, *bytes.get(cursor + 1)?]) as usize;
        if length < 2 || cursor.checked_add(length)? > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            let height = u16::from_be_bytes([bytes[cursor + 3], bytes[cursor + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[cursor + 5], bytes[cursor + 6]]) as u32;
            return Some((width, height));
        }
        cursor += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 20 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let riff_length = u32::from_le_bytes(bytes[4..8].try_into().ok()?) as usize;
    if riff_length.checked_add(8)? != bytes.len() {
        return None;
    }

    let mut cursor = 12usize;
    let mut dimensions = None;
    while range_fits(cursor, 8, bytes.len()) {
        let chunk_kind = &bytes[cursor..cursor + 4];
        let chunk_length =
            u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().ok()?) as usize;
        let payload = cursor.checked_add(8)?;
        let payload_end = payload.checked_add(chunk_length)?;
        let padded_end = payload_end.checked_add(chunk_length % 2)?;
        if padded_end > bytes.len() {
            return None;
        }

        if dimensions.is_none() {
            dimensions = match chunk_kind {
                b"VP8X" if chunk_length >= 10 => Some((
                    u24_le(&bytes[payload + 4..payload + 7]) + 1,
                    u24_le(&bytes[payload + 7..payload + 10]) + 1,
                )),
                b"VP8L" if chunk_length >= 5 && bytes[payload] == 0x2f => {
                    let width = 1
                        + u32::from(bytes[payload + 1])
                        + ((u32::from(bytes[payload + 2]) & 0x3f) << 8);
                    let height = 1
                        + (u32::from(bytes[payload + 2]) >> 6)
                        + (u32::from(bytes[payload + 3]) << 2)
                        + ((u32::from(bytes[payload + 4]) & 0x0f) << 10);
                    Some((width, height))
                }
                b"VP8 "
                    if chunk_length >= 10
                        && bytes[payload + 3..payload + 6] == [0x9d, 0x01, 0x2a] =>
                {
                    Some((
                        u32::from(
                            u16::from_le_bytes([bytes[payload + 6], bytes[payload + 7]]) & 0x3fff,
                        ),
                        u32::from(
                            u16::from_le_bytes([bytes[payload + 8], bytes[payload + 9]]) & 0x3fff,
                        ),
                    ))
                }
                _ => None,
            };
        }
        cursor = padded_end;
    }

    (cursor == bytes.len()).then_some(dimensions).flatten()
}

pub(crate) fn detect_background(bytes: &[u8]) -> Result<(&'static str, u32, u32), String> {
    let detected = if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        png_dimensions(bytes).map(|(width, height)| ("png", width, height))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        jpeg_dimensions(bytes).map(|(width, height)| ("jpeg", width, height))
    } else if bytes.len() >= 20 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        webp_dimensions(bytes).map(|(width, height)| ("webp", width, height))
    } else {
        None
    };
    let (format, width, height) =
        detected.ok_or_else(|| "文件内容不是可识别的 PNG、JPEG 或 WebP 图片".to_string())?;
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".into());
    }
    if width > IMAGE_EDGE_LIMIT
        || height > IMAGE_EDGE_LIMIT
        || u64::from(width) * u64::from(height) > IMAGE_PIXEL_LIMIT
    {
        return Err("图片尺寸过大，请压缩到 10000 像素以内且不超过 4000 万像素".into());
    }
    Ok((format, width, height))
}

fn sfnt_directory_valid(bytes: &[u8]) -> bool {
    if bytes.len() < 12 {
        return false;
    }
    let table_count = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
    let Some(directory_length) = table_count.checked_mul(16) else {
        return false;
    };
    let Some(directory_end) = 12usize.checked_add(directory_length) else {
        return false;
    };
    if table_count == 0 || directory_end > bytes.len() {
        return false;
    }

    (0..table_count).all(|index| {
        let entry = 12 + index * 16;
        let offset = u32::from_be_bytes(bytes[entry + 8..entry + 12].try_into().unwrap()) as usize;
        let length = u32::from_be_bytes(bytes[entry + 12..entry + 16].try_into().unwrap()) as usize;
        offset >= directory_end && range_fits(offset, length, bytes.len())
    })
}

fn woff_directory_valid(bytes: &[u8]) -> bool {
    if bytes.len() < 44 {
        return false;
    }
    let table_count = u16::from_be_bytes([bytes[12], bytes[13]]) as usize;
    let Some(directory_length) = table_count.checked_mul(20) else {
        return false;
    };
    let Some(directory_end) = 44usize.checked_add(directory_length) else {
        return false;
    };
    if table_count == 0 || directory_end > bytes.len() || bytes[14..16] != [0, 0] {
        return false;
    }

    (0..table_count).all(|index| {
        let entry = 44 + index * 20;
        let offset = u32::from_be_bytes(bytes[entry + 4..entry + 8].try_into().unwrap()) as usize;
        let compressed_length =
            u32::from_be_bytes(bytes[entry + 8..entry + 12].try_into().unwrap()) as usize;
        let original_length =
            u32::from_be_bytes(bytes[entry + 12..entry + 16].try_into().unwrap()) as usize;
        offset >= directory_end
            && compressed_length <= original_length
            && range_fits(offset, compressed_length, bytes.len())
    })
}

pub(crate) fn detect_font(bytes: &[u8]) -> Result<&'static str, String> {
    let (format, minimum_header) = if bytes.starts_with(b"wOF2") {
        ("woff2", 48usize)
    } else if bytes.starts_with(b"wOFF") {
        ("woff", 44usize)
    } else if bytes.starts_with(b"OTTO") {
        ("otf", 12usize)
    } else if bytes.starts_with(&[0x00, 0x01, 0x00, 0x00]) || bytes.starts_with(b"true") {
        ("ttf", 12usize)
    } else {
        return Err("文件内容不是受支持的 WOFF2、WOFF、TTF 或 OTF 字体".into());
    };
    if bytes.len() < minimum_header {
        return Err("字体文件头不完整或已经损坏".into());
    }
    if format == "woff" || format == "woff2" {
        let declared_length = u32::from_be_bytes(bytes[8..12].try_into().unwrap()) as usize;
        if declared_length != bytes.len() {
            return Err("字体文件长度与文件头不一致".into());
        }
        let table_count = u16::from_be_bytes(bytes[12..14].try_into().unwrap()) as usize;
        if table_count == 0 || bytes[14..16] != [0, 0] {
            return Err("字体表目录不完整或已经损坏".into());
        }
        if format == "woff" && !woff_directory_valid(bytes) {
            return Err("WOFF 字体表数据越界或已经损坏".into());
        }
        if format == "woff2" {
            let total_sfnt_size = u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as usize;
            let compressed_size = u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as usize;
            if total_sfnt_size < 12
                || compressed_size == 0
                || compressed_size > bytes.len().saturating_sub(48)
            {
                return Err("WOFF2 压缩数据不完整或已经损坏".into());
            }
        }
    } else if !sfnt_directory_valid(bytes) {
        return Err("字体表数据越界或已经损坏".into());
    }
    Ok(format)
}

#[cfg(test)]
mod tests {
    use super::{detect_background, detect_font, extension_matches};

    fn png_fixture() -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&32u32.to_be_bytes());
        bytes.extend_from_slice(&16u32.to_be_bytes());
        bytes.extend_from_slice(&[8, 2, 0, 0, 0]);
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(b"IEND");
        bytes.extend_from_slice(&[0; 4]);
        bytes
    }

    fn webp_fixture() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&22u32.to_le_bytes());
        bytes.extend_from_slice(b"WEBPVP8X");
        bytes.extend_from_slice(&10u32.to_le_bytes());
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&[31, 0, 0]);
        bytes.extend_from_slice(&[15, 0, 0]);
        bytes
    }

    fn sfnt_fixture() -> Vec<u8> {
        let mut bytes = vec![0x00, 0x01, 0x00, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
        bytes.extend_from_slice(b"name");
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&28u32.to_be_bytes());
        bytes.extend_from_slice(&4u32.to_be_bytes());
        bytes.extend_from_slice(&[1, 2, 3, 4]);
        bytes
    }

    fn woff_fixture() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"wOFF");
        bytes.extend_from_slice(&[0x00, 0x01, 0x00, 0x00]);
        bytes.extend_from_slice(&68u32.to_be_bytes());
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&32u32.to_be_bytes());
        bytes.extend_from_slice(&[0; 24]);
        bytes.extend_from_slice(b"name");
        bytes.extend_from_slice(&64u32.to_be_bytes());
        bytes.extend_from_slice(&4u32.to_be_bytes());
        bytes.extend_from_slice(&4u32.to_be_bytes());
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&[1, 2, 3, 4]);
        bytes
    }

    #[test]
    fn validates_complete_image_containers() {
        assert_eq!(detect_background(&png_fixture()).unwrap(), ("png", 32, 16));
        assert_eq!(
            detect_background(&webp_fixture()).unwrap(),
            ("webp", 32, 16)
        );
        let jpeg = [
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0xff, 0xd9,
        ];
        assert_eq!(detect_background(&jpeg).unwrap(), ("jpeg", 32, 16));
    }

    #[test]
    fn rejects_truncated_or_length_mismatched_images() {
        let mut png = png_fixture();
        png.truncate(png.len() - 12);
        assert!(detect_background(&png).is_err());

        let mut webp = webp_fixture();
        webp[4..8].copy_from_slice(&21u32.to_le_bytes());
        assert!(detect_background(&webp).is_err());

        let jpeg = [
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03,
        ];
        assert!(detect_background(&jpeg).is_err());
    }

    #[test]
    fn validates_font_table_boundaries() {
        assert_eq!(detect_font(&sfnt_fixture()).unwrap(), "ttf");
        assert_eq!(detect_font(&woff_fixture()).unwrap(), "woff");

        let mut sfnt = sfnt_fixture();
        sfnt[20..24].copy_from_slice(&80u32.to_be_bytes());
        assert!(detect_font(&sfnt).is_err());

        let mut woff = woff_fixture();
        woff[48..52].copy_from_slice(&80u32.to_be_bytes());
        assert!(detect_font(&woff).is_err());
    }

    #[test]
    fn jpeg_extensions_are_the_only_aliases() {
        assert!(extension_matches("jpeg", "jpg"));
        assert!(extension_matches("jpeg", "jpeg"));
        assert!(!extension_matches("png", "jpg"));
    }
}
