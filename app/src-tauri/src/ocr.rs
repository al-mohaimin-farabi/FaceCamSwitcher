use image::RgbImage;
use ndarray::Array4;
use ort::session::Session;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

static DET_SESSION: OnceLock<Mutex<Session>> = OnceLock::new();
static REC_SESSION: OnceLock<Mutex<Session>> = OnceLock::new();
static CHAR_DICT: OnceLock<Vec<String>> = OnceLock::new();

/// Initialize ONNX sessions and character dictionary. Call once at startup.
pub fn init_ocr(models_dir: &Path) -> Result<(), String> {
    let det_path = models_dir.join("det.onnx");
    let rec_path = models_dir.join("rec.onnx");
    let dict_path = models_dir.join("en_dict.txt");

    if !det_path.exists() {
        return Err(format!(
            "Detection model not found: {}",
            det_path.display()
        ));
    }
    if !rec_path.exists() {
        return Err(format!(
            "Recognition model not found: {}",
            rec_path.display()
        ));
    }
    if !dict_path.exists() {
        return Err(format!(
            "Character dict not found: {}",
            dict_path.display()
        ));
    }

    let det = Session::builder()
        .map_err(|e| format!("Det session builder failed: {e}"))?
        .with_intra_threads(4)
        .map_err(|e| format!("Det set threads failed: {e}"))?
        .commit_from_file(&det_path)
        .map_err(|e| format!("Det model load failed: {e}"))?;

    let rec = Session::builder()
        .map_err(|e| format!("Rec session builder failed: {e}"))?
        .with_intra_threads(4)
        .map_err(|e| format!("Rec set threads failed: {e}"))?
        .commit_from_file(&rec_path)
        .map_err(|e| format!("Rec model load failed: {e}"))?;

    let dict_content =
        std::fs::read_to_string(&dict_path).map_err(|e| format!("Dict read failed: {e}"))?;
    let mut chars: Vec<String> = vec!["blank".to_string()]; // CTC blank at index 0
    chars.extend(dict_content.lines().map(|l| l.to_string()));
    chars.push(" ".to_string()); // space token

    DET_SESSION
        .set(Mutex::new(det))
        .map_err(|_| "Det session already initialized".to_string())?;
    REC_SESSION
        .set(Mutex::new(rec))
        .map_err(|_| "Rec session already initialized".to_string())?;
    CHAR_DICT
        .set(chars)
        .map_err(|_| "Dict already initialized".to_string())?;

    Ok(())
}

/// Check whether OCR models have been loaded.
pub fn is_initialized() -> bool {
    DET_SESSION.get().is_some()
}

pub fn run_ocr(img: &RgbImage) -> Result<Vec<OcrResult>, String> {
    let mut results = Vec::new();

    // If the captured region is a small horizontal band (e.g. user manually cropped a single name),
    // bypass DBNet detection completely. This prevents the text kernels from being accidentally trimmed
    // and feeds the pristine native pixels directly into the recognition engine for massive accuracy boosts.
    if img.height() <= 120 {
        match recognize_text(img) {
            Ok(tr) => {
                if tr.confidence > 0.2 && !tr.text.trim().is_empty() {
                    results.push(OcrResult {
                        text: tr.text,
                        confidence: tr.confidence,
                        bbox: [0.0, 0.0, img.width() as f32, img.height() as f32],
                    });
                }
            }
            Err(_) => {}
        }
        return Ok(results);
    }

    // For large screen patches, run full text detection first
    let boxes = detect_text(img)?;

    for bbox in boxes {
        let cropped = crop_text_region(img, &bbox);
        if cropped.width() < 3 || cropped.height() < 3 {
            continue;
        }
        match recognize_text(&cropped) {
            Ok(tr) => {
                if tr.confidence > 0.3 && !tr.text.trim().is_empty() {
                    results.push(OcrResult {
                        text: tr.text,
                        confidence: tr.confidence,
                        bbox,
                    });
                }
            }
            Err(_) => continue,
        }
    }

    Ok(results)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OcrResult {
    pub text: String,
    pub confidence: f32,
    pub bbox: [f32; 4], // x, y, w, h relative to input image
}

struct TextResult {
    text: String,
    confidence: f32,
}

// ── Detection ──────────────────────────────────────────────────────────

fn detect_text(img: &RgbImage) -> Result<Vec<[f32; 4]>, String> {
    let session_mutex = DET_SESSION.get().ok_or("OCR not initialized")?;
    let mut session = session_mutex.lock().map_err(|e| format!("Det session lock failed: {e}"))?;

    let (orig_w, orig_h) = (img.width(), img.height());
    let max_side = 640u32;
    let ratio = (max_side as f32 / orig_w.max(orig_h) as f32).min(1.0);
    let new_w = ((orig_w as f32 * ratio) as u32 / 32 * 32).max(32);
    let new_h = ((orig_h as f32 * ratio) as u32 / 32 * 32).max(32);

    let resized =
        image::imageops::resize(img, new_w, new_h, image::imageops::FilterType::Nearest);

    // Normalize with ImageNet mean/std
    let mean = [0.485f32, 0.456, 0.406];
    let std_dev = [0.229f32, 0.224, 0.225];
    let mut input = Array4::<f32>::zeros((1, 3, new_h as usize, new_w as usize));
    let raw = resized.as_raw();
    for (idx, chunk) in raw.chunks(3).enumerate() {
        let x = idx % new_w as usize;
        let y = idx / new_w as usize;
        for c in 0..3usize {
            input[[0, c, y, x]] = (chunk[c] as f32 / 255.0 - mean[c]) / std_dev[c];
        }
    }

    // Create ort Value from ndarray view
    let input_value = ort::value::Value::from_array(input)
        .map_err(|e| format!("Det input tensor creation failed: {e}"))?;

    let outputs = session
        .run(ort::inputs![input_value])
        .map_err(|e| format!("Det inference failed: {e}"))?;

    // Extract output as flat data with shape
    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Det output extract failed: {e}"))?;

    // shape = [1, 1, H, W] for the probability map
    let h = shape[2] as usize;
    let w = shape[3] as usize;
    let threshold = 0.3f32;

    // Build binary mask
    let mut mask = vec![false; h * w];
    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x; // shape [1,1,H,W] so offset is just y*w+x
            if data[idx] > threshold {
                mask[idx] = true;
            }
        }
    }

    // Find bounding boxes via flood fill on the mask
    let mut visited = vec![false; h * w];
    let mut boxes = Vec::new();

    for start_y in 0..h {
        for start_x in 0..w {
            let idx = start_y * w + start_x;
            if !mask[idx] || visited[idx] {
                continue;
            }

            let (mut min_x, mut min_y, mut max_x, mut max_y) =
                (start_x, start_y, start_x, start_y);
            let mut stack = vec![(start_x, start_y)];

            while let Some((cx, cy)) = stack.pop() {
                let ci = cy * w + cx;
                if visited[ci] || !mask[ci] {
                    continue;
                }
                visited[ci] = true;
                min_x = min_x.min(cx);
                min_y = min_y.min(cy);
                max_x = max_x.max(cx);
                max_y = max_y.max(cy);

                if cx > 0 {
                    stack.push((cx - 1, cy));
                }
                if cx + 1 < w {
                    stack.push((cx + 1, cy));
                }
                if cy > 0 {
                    stack.push((cx, cy - 1));
                }
                if cy + 1 < h {
                    stack.push((cx, cy + 1));
                }
            }

            let bw = (max_x - min_x + 1) as f32;
            let bh = (max_y - min_y + 1) as f32;
            if bw > 5.0 && bh > 5.0 {
                // DBNet inherently outputs a heavily shrunken/eroded text kernel.
                // We must apply pseudo-Vatti clipping to expand the borders back outwards,
                // otherwise the recognizer will lack the edges of the first and last characters.
                let pad_x = bh * 0.45; 
                let pad_y = bh * 0.25;

                let expanded_min_x = (min_x as f32 - pad_x).max(0.0);
                let expanded_min_y = (min_y as f32 - pad_y).max(0.0);
                let expanded_max_x = (max_x as f32 + pad_x).min(new_w as f32 - 1.0);
                let expanded_max_y = (max_y as f32 + pad_y).min(new_h as f32 - 1.0);
                
                let exp_bw = expanded_max_x - expanded_min_x + 1.0;
                let exp_bh = expanded_max_y - expanded_min_y + 1.0;

                let scale_x = orig_w as f32 / new_w as f32;
                let scale_y = orig_h as f32 / new_h as f32;
                boxes.push([
                    expanded_min_x * scale_x,
                    expanded_min_y * scale_y,
                    exp_bw * scale_x,
                    exp_bh * scale_y,
                ]);
            }
        }
    }

    Ok(boxes)
}

// ── Recognition ────────────────────────────────────────────────────────

fn recognize_text(img: &RgbImage) -> Result<TextResult, String> {
    let session_mutex = REC_SESSION.get().ok_or("OCR not initialized")?;
    let mut session = session_mutex.lock().map_err(|e| format!("Rec session lock failed: {e}"))?;
    let dict = CHAR_DICT.get().ok_or("Dict not initialized")?;

    let target_h = 48u32;
    let ratio = target_h as f32 / img.height().max(1) as f32;
    let target_w = ((img.width() as f32 * ratio) as u32).max(48);
    let resized =
        image::imageops::resize(img, target_w, target_h, image::imageops::FilterType::Nearest);

    // Normalize: (pixel / 255.0 - 0.5) / 0.5 → maps to [-1, 1]
    let mut input = Array4::<f32>::zeros((1, 3, target_h as usize, target_w as usize));
    let raw = resized.as_raw();
    for (idx, chunk) in raw.chunks(3).enumerate() {
        let x = idx % target_w as usize;
        let y = idx / target_w as usize;
        for c in 0..3usize {
            input[[0, c, y, x]] = (chunk[c] as f32 / 255.0 - 0.5) / 0.5;
        }
    }

    let input_value = ort::value::Value::from_array(input)
        .map_err(|e| format!("Rec input tensor creation failed: {e}"))?;

    let outputs = session
        .run(ort::inputs![input_value])
        .map_err(|e| format!("Rec inference failed: {e}"))?;

    // Output shape: [1, T, V] where T = timesteps, V = vocab size
    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Rec output extract failed: {e}"))?;

    let seq_len = shape[1] as usize;
    let vocab_size = shape[2] as usize;

    // CTC decode: argmax at each timestep, collapse duplicates, remove blanks
    let mut text = String::new();
    let mut total_conf = 0.0f32;
    let mut char_count = 0u32;
    let mut prev_idx = 0usize; // 0 = blank

    for t in 0..seq_len {
        let offset = t * vocab_size;
        let mut max_idx = 0usize;
        let mut max_val = f32::NEG_INFINITY;
        for v in 0..vocab_size {
            let val = data[offset + v];
            if val > max_val {
                max_val = val;
                max_idx = v;
            }
        }

        // CTC: skip blanks and duplicates
        if max_idx != 0 && max_idx != prev_idx {
            // PaddleOCR rec models exported to ONNX usually include a Softmax layer at the end.
            // This means `max_val` is already a probability in [0, 1].
            // If the model outputs raw logits (max_val > 1.0 or < 0.0), we normalize it.
            let conf = if max_val > 1.01 || max_val < 0.0 {
                let sum_exp: f32 = (0..vocab_size)
                    .map(|v| (data[offset + v] - max_val).exp())
                    .sum();
                1.0 / sum_exp
            } else {
                max_val
            };
            
            total_conf += conf;
            char_count += 1;

            if max_idx < dict.len() {
                text.push_str(&dict[max_idx]);
            }
        }
        prev_idx = max_idx;
    }

    let avg_confidence = if char_count > 0 {
        total_conf / char_count as f32
    } else {
        0.0
    };

    Ok(TextResult {
        text: text.trim().to_string(),
        confidence: avg_confidence,
    })
}

/// Crop a bounding box region from the image.
fn crop_text_region(img: &RgbImage, bbox: &[f32; 4]) -> RgbImage {
    let dyn_img = image::DynamicImage::ImageRgb8(img.clone());
    let iw = img.width();
    let ih = img.height();
    let x = (bbox[0] as u32).min(iw.saturating_sub(1));
    let y = (bbox[1] as u32).min(ih.saturating_sub(1));
    let w = (bbox[2] as u32).min(iw.saturating_sub(x)).max(1);
    let h = (bbox[3] as u32).min(ih.saturating_sub(y)).max(1);
    dyn_img.crop_imm(x, y, w, h).to_rgb8()
}
