use image::{DynamicImage, RgbImage};
use std::io::Cursor;
use xcap::{Monitor, Window};

/// Capture a region from the primary monitor (screen mode).
pub fn capture_screen_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<DynamicImage, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {e}"))?;
    let monitor = monitors.into_iter().next().ok_or("No monitors found")?;

    let full = monitor
        .capture_image()
        .map_err(|e| format!("Screen capture failed: {e}"))?;
    let full_dyn = DynamicImage::from(full);

    let cx = (x as u32).min(full_dyn.width().saturating_sub(1));
    let cy = (y as u32).min(full_dyn.height().saturating_sub(1));
    let cw = width.min(full_dyn.width().saturating_sub(cx)).max(1);
    let ch = height.min(full_dyn.height().saturating_sub(cy)).max(1);

    Ok(full_dyn.crop_imm(cx, cy, cw, ch))
}

/// Capture a region from a specific window by HWND.
pub fn capture_window_region(
    hwnd: isize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<DynamicImage, String> {
    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {e}"))?;
    let window = windows
        .into_iter()
        .find(|w| w.id() as isize == hwnd)
        .ok_or(format!("Window with HWND {hwnd} not found"))?;

    let full = window
        .capture_image()
        .map_err(|e| format!("Window capture failed: {e}"))?;
    let full_dyn = DynamicImage::from(full);

    // If width/height are 0, capture the full window
    if width == 0 || height == 0 {
        return Ok(full_dyn);
    }

    let cx = (x as u32).min(full_dyn.width().saturating_sub(1));
    let cy = (y as u32).min(full_dyn.height().saturating_sub(1));
    let cw = width.min(full_dyn.width().saturating_sub(cx)).max(1);
    let ch = height.min(full_dyn.height().saturating_sub(cy)).max(1);

    Ok(full_dyn.crop_imm(cx, cy, cw, ch))
}

/// List all visible windows with their HWND and title.
pub fn list_all_windows() -> Result<Vec<(isize, String)>, String> {
    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {e}"))?;
    let result: Vec<(isize, String)> = windows
        .into_iter()
        .filter(|w| {
            let title = w.title();
            !title.is_empty()
                && title != "Default IME"
                && title != "MSCTFIME UI"
                && !title.starts_with("Windows.")
        })
        .map(|w| (w.id() as isize, w.title().to_string()))
        .collect();
    Ok(result)
}

/// Encode an image to base64 JPEG for frontend preview.
pub fn image_to_base64_jpeg(img: &DynamicImage) -> Result<String, String> {
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        buf.into_inner(),
    ))
}

/// Capture a single frame from a camera device by DirectShow index.
/// Finds the matching MF device by name, then captures via MF source reader.
pub fn capture_camera_frame(ds_index: u32) -> Result<DynamicImage, String> {
    // Get the device name from DirectShow at the given index
    let ds_name = get_ds_device_name(ds_index);

    // Find the matching MF index by name
    if let Some(name) = &ds_name {
        if let Some(mf_index) = find_mf_index_by_name(name) {
            println!("[CAMERA] DS index {} ('{}') -> MF index {}", ds_index, name, mf_index);
            match capture_camera_frame_mf(mf_index) {
                Ok(img) => return Ok(img),
                Err(e) => {
                    eprintln!("[CAMERA] MF capture failed for '{}' (MF index {}): {e}", name, mf_index);
                }
            }
        }
    }

    // Try MF with the same index directly (might work if order matches)
    match capture_camera_frame_mf(ds_index) {
        Ok(img) => return Ok(img),
        Err(e) => {
            eprintln!("[CAMERA] MF direct index {} failed: {e}, trying nokhwa...", ds_index);
        }
    }

    // Fallback: nokhwa
    match capture_camera_frame_nokhwa(ds_index) {
        Ok(img) => return Ok(img),
        Err(e) => {
            eprintln!("[CAMERA] nokhwa also failed for index {ds_index}: {e}");
            Err(format!("Could not capture from camera {ds_index}. Make sure the camera is not in use by another application."))
        }
    }
}

/// Get the friendly name of a DirectShow device by index.
fn get_ds_device_name(ds_index: u32) -> Option<String> {
    use windows::Win32::Media::DirectShow::ICreateDevEnum;
    use windows::Win32::Media::MediaFoundation::{
        CLSID_SystemDeviceEnum, CLSID_VideoInputDeviceCategory,
    };
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Com::StructuredStorage::IPropertyBag;
    use windows::core::VARIANT;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let dev_enum: ICreateDevEnum = CoCreateInstance(
            &CLSID_SystemDeviceEnum, None, CLSCTX_INPROC_SERVER,
        ).ok()?;

        let mut enum_moniker: Option<IEnumMoniker> = None;
        dev_enum.CreateClassEnumerator(
            &CLSID_VideoInputDeviceCategory, &mut enum_moniker, 0,
        ).ok()?;

        let enum_moniker = enum_moniker?;
        let mut moniker_arr: [Option<IMoniker>; 1] = [None];
        let mut fetched = 0u32;

        for _ in 0..ds_index {
            if enum_moniker.Next(&mut moniker_arr, Some(&mut fetched)).is_err() || fetched == 0 {
                return None;
            }
            moniker_arr[0] = None;
        }

        if enum_moniker.Next(&mut moniker_arr, Some(&mut fetched)).is_err() || fetched == 0 {
            return None;
        }

        let moniker = moniker_arr[0].as_ref()?;
        let bag: IPropertyBag = moniker.BindToStorage(None, None).ok()?;
        let mut var = VARIANT::default();
        let prop = windows::core::BSTR::from("FriendlyName");
        bag.Read(&prop, &mut var, None).ok()?;
        windows::core::BSTR::try_from(&var).ok().map(|s| s.to_string())
    }
}

/// Find the MF device index that matches a given friendly name.
fn find_mf_index_by_name(target_name: &str) -> Option<u32> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::*;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).ok()?;

        let mut attributes: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attributes, 1).ok()?;
        let attributes = attributes?;

        attributes.SetGUID(
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        ).ok()?;

        let mut devices_ptr: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count: u32 = 0;
        MFEnumDeviceSources(&attributes, &mut devices_ptr, &mut count).ok()?;

        if count == 0 || devices_ptr.is_null() {
            MFShutdown().ok();
            return None;
        }

        let devices = std::slice::from_raw_parts(devices_ptr, count as usize);
        let target_lower = target_name.to_lowercase();
        let mut found = None;

        for i in 0..count {
            if let Some(ref activate) = devices[i as usize] {
                let mut name_ptr = windows::core::PWSTR::null();
                let mut name_len = 0u32;
                if activate.GetAllocatedString(
                    &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
                    &mut name_ptr,
                    &mut name_len,
                ).is_ok() {
                    if let Ok(name) = name_ptr.to_string() {
                        if name.to_lowercase() == target_lower {
                            found = Some(i);
                        }
                    }
                    CoTaskMemFree(Some(name_ptr.as_ptr() as *const _));
                }
            }
        }

        CoTaskMemFree(Some(devices_ptr as *const _));
        MFShutdown().ok();
        found
    }
}

fn capture_camera_frame_nokhwa(camera_index: u32) -> Result<DynamicImage, String> {
    use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
    use nokhwa::pixel_format::RgbFormat;
    use nokhwa::Camera;

    let index = CameraIndex::Index(camera_index);
    let format = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);

    let mut camera = Camera::new(index, format)
        .map_err(|e| format!("Failed to open camera {camera_index}: {e}"))?;

    camera.open_stream()
        .map_err(|e| format!("Failed to open camera stream: {e}"))?;

    let frame = camera.frame()
        .map_err(|e| format!("Failed to capture camera frame: {e}"))?;

    let decoded = frame.decode_image::<RgbFormat>()
        .map_err(|e| format!("Failed to decode camera frame: {e}"))?;

    let _ = camera.stop_stream();
    Ok(DynamicImage::ImageRgb8(decoded))
}

fn capture_camera_frame_mf(camera_index: u32) -> Result<DynamicImage, String> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::*;

    unsafe {
        // Initialize COM + MF
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET)
            .map_err(|e| format!("MFStartup failed: {e}"))?;

        // Create attributes to request video capture devices
        let mut attributes: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attributes, 1)
            .map_err(|e| format!("MFCreateAttributes failed: {e}"))?;
        let attributes = attributes.ok_or("MFCreateAttributes returned null")?;

        attributes.SetGUID(
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        ).map_err(|e| format!("SetGUID failed: {e}"))?;

        // Enumerate all video capture devices
        let mut devices_ptr: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count: u32 = 0;
        MFEnumDeviceSources(&attributes, &mut devices_ptr, &mut count)
            .map_err(|e| format!("MFEnumDeviceSources failed: {e}"))?;

        if camera_index >= count {
            MFShutdown().ok();
            return Err(format!(
                "Camera index {} out of range (found {} devices)", camera_index, count
            ));
        }

        let devices = std::slice::from_raw_parts(devices_ptr, count as usize);
        let activate = devices[camera_index as usize]
            .as_ref()
            .ok_or("Device activation object is null")?;

        // Activate the media source
        let source: IMFMediaSource = activate.ActivateObject()
            .map_err(|e| format!("ActivateObject failed: {e}"))?;

        // Create source reader
        let reader = MFCreateSourceReaderFromMediaSource(&source, None)
            .map_err(|e| format!("CreateSourceReader failed: {e}"))?;

        // Request RGB32 output
        let output_type: IMFMediaType = MFCreateMediaType()
            .map_err(|e| format!("MFCreateMediaType failed: {e}"))?;
        output_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(|e| format!("SetGUID major failed: {e}"))?;
        output_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
            .map_err(|e| format!("SetGUID subtype failed: {e}"))?;

        reader.SetCurrentMediaType(
            MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
            None,
            &output_type,
        ).map_err(|e| format!("SetCurrentMediaType failed: {e}"))?;

        // Read a sample
        let mut stream_index = 0u32;
        let mut flags = 0u32;
        let mut timestamp = 0i64;
        let mut sample: Option<IMFSample> = None;
        reader.ReadSample(
            MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
            0,
            Some(&mut stream_index),
            Some(&mut flags),
            Some(&mut timestamp),
            Some(&mut sample),
        ).map_err(|e| format!("ReadSample failed: {e}"))?;

        let sample = sample.ok_or("No sample received from camera")?;

        // Get buffer from sample
        let buffer = sample.ConvertToContiguousBuffer()
            .map_err(|e| format!("ConvertToContiguousBuffer failed: {e}"))?;

        let mut buf_ptr: *mut u8 = std::ptr::null_mut();
        let mut buf_len: u32 = 0;
        buffer.Lock(&mut buf_ptr, None, Some(&mut buf_len))
            .map_err(|e| format!("Buffer lock failed: {e}"))?;

        let data = std::slice::from_raw_parts(buf_ptr, buf_len as usize);

        // Get dimensions from the actual media type
        let actual_type = reader.GetCurrentMediaType(
            MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
        ).map_err(|e| format!("GetCurrentMediaType failed: {e}"))?;

        let frame_size = actual_type.GetUINT64(&MF_MT_FRAME_SIZE)
            .map_err(|e| format!("GetUINT64 frame size failed: {e}"))?;
        let w = (frame_size >> 32) as u32;
        let h = (frame_size & 0xFFFFFFFF) as u32;

        // Convert RGB32 (BGRA) to RGB image
        let mut img = image::RgbImage::new(w, h);
        let stride = (w * 4) as usize;
        for y in 0..h {
            for x in 0..w {
                let offset = (y as usize) * stride + (x as usize) * 4;
                if offset + 2 < data.len() {
                    let b = data[offset];
                    let g = data[offset + 1];
                    let r = data[offset + 2];
                    img.put_pixel(x, y, image::Rgb([r, g, b]));
                }
            }
        }

        buffer.Unlock().ok();

        // Clean up
        let _ = source.Shutdown();
        // Free device array
        for i in 0..count as usize {
            drop(devices[i].clone());
        }
        CoTaskMemFree(Some(devices_ptr as *const _));

        MFShutdown().ok();

        Ok(DynamicImage::ImageRgb8(img))
    }
}

/// Preprocess for OCR: PaddleOCR models are trained on raw RGB images.
/// Grayscale + aggressive contrast stretching actually destroys subpixel font rendering and hurts accuracy.
pub fn preprocess_for_ocr(img: &DynamicImage) -> RgbImage {
    img.to_rgb8()
}
