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
pub fn capture_camera_frame(camera_index: u32) -> Result<DynamicImage, String> {
    let mut errors: Vec<String> = Vec::new();

    // 1. Try MF name-matched from DS index
    let ds_name = get_ds_device_name(camera_index);
    if let Some(ref name) = ds_name {
        eprintln!("[CAMERA] DS index {} = '{}'", camera_index, name);
        if let Some(mf_idx) = find_mf_index_by_name(name) {
            eprintln!("[CAMERA] Matched MF index {}", mf_idx);
            match capture_camera_frame_mf(mf_idx) {
                Ok(img) => return Ok(img),
                Err(e) => {
                    eprintln!("[CAMERA] MF name-matched failed: {}", e);
                    errors.push(format!("MF(name={}): {}", mf_idx, e));
                }
            }
        } else {
            errors.push(format!("MF: device '{}' not found in MF", name));
        }
    } else {
        errors.push(format!("DS: no device at index {}", camera_index));
    }

    // 2. Try MF with same index
    match capture_camera_frame_mf(camera_index) {
        Ok(img) => return Ok(img),
        Err(e) => {
            eprintln!("[CAMERA] MF direct #{} failed: {}", camera_index, e);
            errors.push(format!("MF(idx={}): {}", camera_index, e));
        }
    }

    // 3. Try pure DirectShow capture
    match capture_camera_frame_dshow(camera_index) {
        Ok(img) => return Ok(img),
        Err(e) => {
            eprintln!("[CAMERA] DS capture #{} failed: {}", camera_index, e);
            errors.push(format!("DS: {}", e));
        }
    }

    // 4. Last resort: nokhwa
    match capture_camera_frame_nokhwa(camera_index) {
        Ok(img) => return Ok(img),
        Err(e) => {
            eprintln!("[CAMERA] nokhwa #{} failed: {}", camera_index, e);
            errors.push(format!("nokhwa: {}", e));
        }
    }

    Err(format!("All capture methods failed for camera {}:\n{}", camera_index, errors.join("\n")))
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
        let mut best_score = 0usize;
        for i in 0..count {
            if let Some(ref activate) = devices[i as usize] {
                let mut name_ptr = windows::core::PWSTR::null();
                let mut name_len = 0u32;
                if activate.GetAllocatedString(
                    &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
                    &mut name_ptr, &mut name_len,
                ).is_ok() {
                    if let Ok(name) = name_ptr.to_string() {
                        let mf_lower = name.to_lowercase();
                        eprintln!("[CAMERA] MF device {}: '{}'", i, name);

                        // Exact match
                        if mf_lower == target_lower {
                            found = Some(i);
                            best_score = usize::MAX;
                        } else if best_score < usize::MAX {
                            // Fuzzy: check if one contains the other
                            if mf_lower.contains(&target_lower) || target_lower.contains(&mf_lower) {
                                let score = target_lower.len().min(mf_lower.len());
                                if score > best_score {
                                    best_score = score;
                                    found = Some(i);
                                }
                            }
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

// ── Pure DirectShow capture (for virtual cameras) ────────────────────

// GUIDs not in the windows crate (from qedit.h / strmif.h)
const CLSID_FILTER_GRAPH: windows::core::GUID =
    windows::core::GUID::from_u128(0xe436ebb3_524f_11ce_9f53_0020af0ba770);
const CLSID_SAMPLE_GRABBER: windows::core::GUID =
    windows::core::GUID::from_u128(0xc1f400a0_3f08_11d3_9f0b_006008039e37);
const CLSID_NULL_RENDERER: windows::core::GUID =
    windows::core::GUID::from_u128(0xc1f400a4_3f08_11d3_9f0b_006008039e37);
const CLSID_CAPTURE_GRAPH_BUILDER2: windows::core::GUID =
    windows::core::GUID::from_u128(0xbf87b6e1_8c27_11d0_b3f0_00aa003761c5);
const PIN_CATEGORY_CAPTURE_GUID: windows::core::GUID =
    windows::core::GUID::from_u128(0xfb6c4281_0353_11d1_905f_0000c0cc16ba);
const MEDIATYPE_VIDEO_GUID: windows::core::GUID =
    windows::core::GUID::from_u128(0x73646976_0000_0010_8000_00aa00389b71);
const MEDIASUBTYPE_RGB24_GUID: windows::core::GUID =
    windows::core::GUID::from_u128(0xe436eb7d_524f_11ce_9f53_0020af0ba770);

// ISampleGrabber COM interface (from qedit.h)
// IID: {6B652FFF-11FE-4fce-92AD-0266B5D7C78F}
#[repr(C)]
struct SampleGrabberVtbl {
    // IUnknown
    query_interface: usize,
    add_ref: usize,
    release: usize,
    // ISampleGrabber
    set_one_shot: unsafe extern "system" fn(*mut core::ffi::c_void, i32) -> i32,
    set_media_type: unsafe extern "system" fn(*mut core::ffi::c_void, *const DsMediaType) -> i32,
    get_connected_media_type: unsafe extern "system" fn(*mut core::ffi::c_void, *mut DsMediaType) -> i32,
    set_buffer_samples: unsafe extern "system" fn(*mut core::ffi::c_void, i32) -> i32,
    get_current_buffer: unsafe extern "system" fn(*mut core::ffi::c_void, *mut i32, *mut u8) -> i32,
    get_current_sample: usize,
    set_callback: usize,
}

#[repr(C)]
#[derive(Default, Clone)]
struct DsMediaType {
    majortype: windows::core::GUID,
    subtype: windows::core::GUID,
    fixed_size_samples: i32,
    temporal_compression: i32,
    sample_size: u32,
    format_type: windows::core::GUID,
    unk: usize,
    cb_format: u32,
    pb_format: *mut u8,
}

#[repr(C)]
#[allow(dead_code)]
struct VideoInfoHeader {
    rc_source: [i32; 4],
    rc_target: [i32; 4],
    bit_rate: u32,
    bit_error_rate: u32,
    avg_time_per_frame: i64,
    bmi_header: BitmapInfoHeader,
}

#[repr(C)]
#[allow(dead_code)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_pels_per_meter: i32,
    y_pels_per_meter: i32,
    clr_used: u32,
    clr_important: u32,
}

/// Capture a frame using pure DirectShow filter graph.
/// Runs in a dedicated STA thread with message pump (required for DS).
fn capture_camera_frame_dshow(ds_index: u32) -> Result<DynamicImage, String> {
    // DirectShow requires STA + message pump, so run in a dedicated thread
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = std::thread::spawn(move || {
        let result = capture_camera_frame_dshow_inner(ds_index);
        let _ = tx.send(result);
    });
    let result = rx.recv().map_err(|e| format!("DS: thread recv failed: {e}"))?;
    let _ = handle.join();
    result
}

fn capture_camera_frame_dshow_inner(ds_index: u32) -> Result<DynamicImage, String> {
    use windows::Win32::Media::DirectShow::*;
    use windows::Win32::Media::MediaFoundation::{
        CLSID_SystemDeviceEnum, CLSID_VideoInputDeviceCategory,
    };
    use windows::Win32::System::Com::*;
    use windows::core::Interface;

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok().map_err(|e| format!("DS: CoInitialize failed: {e}"))?;

        let iid_sample_grabber = windows::core::GUID::from_u128(
            0x6b652fff_11fe_4fce_92ad_0266b5d7c78f
        );

        // Get moniker for the device
        let dev_enum: ICreateDevEnum = CoCreateInstance(
            &CLSID_SystemDeviceEnum, None, CLSCTX_INPROC_SERVER,
        ).map_err(|e| format!("DS: CoCreateInstance failed: {e}"))?;

        let mut enum_moniker: Option<IEnumMoniker> = None;
        dev_enum.CreateClassEnumerator(
            &CLSID_VideoInputDeviceCategory, &mut enum_moniker, 0,
        ).map_err(|e| format!("DS: CreateClassEnumerator failed: {e}"))?;
        let enum_moniker = enum_moniker.ok_or("DS: No video devices")?;

        let mut moniker_arr: [Option<IMoniker>; 1] = [None];
        let mut fetched = 0u32;
        for _ in 0..ds_index {
            if enum_moniker.Next(&mut moniker_arr, Some(&mut fetched)).is_err() || fetched == 0 {
                return Err(format!("DS: Camera index {} not found", ds_index));
            }
            moniker_arr[0] = None;
        }
        if enum_moniker.Next(&mut moniker_arr, Some(&mut fetched)).is_err() || fetched == 0 {
            return Err(format!("DS: Camera index {} not found", ds_index));
        }
        let moniker = moniker_arr[0].take().ok_or("DS: No moniker")?;

        // Create filter graph
        let graph: IGraphBuilder = CoCreateInstance(
            &CLSID_FILTER_GRAPH, None, CLSCTX_INPROC_SERVER,
        ).map_err(|e| format!("DS: FilterGraph failed: {e}"))?;

        let capture_filter: IBaseFilter = moniker.BindToObject(None, None)
            .map_err(|e| format!("DS: BindToObject failed: {e}"))?;
        graph.AddFilter(&capture_filter, windows::core::w!("Capture"))
            .map_err(|e| format!("DS: AddFilter capture failed: {e}"))?;

        // Create SampleGrabber and get raw ISampleGrabber vtable
        let grabber_filter: IBaseFilter = CoCreateInstance(
            &CLSID_SAMPLE_GRABBER, None, CLSCTX_INPROC_SERVER,
        ).map_err(|e| format!("DS: SampleGrabber create failed: {e}"))?;

        let mut grabber_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let _ = (grabber_filter.vtable().base__.base__.base__.QueryInterface)(
            grabber_filter.as_raw(), &iid_sample_grabber, &mut grabber_ptr,
        );
        if grabber_ptr.is_null() {
            return Err("DS: QueryInterface ISampleGrabber failed".into());
        }
        let vt = *(grabber_ptr as *const *const usize);

        type SetI32Fn = unsafe extern "system" fn(*mut core::ffi::c_void, i32) -> i32;
        type SetMtFn = unsafe extern "system" fn(*mut core::ffi::c_void, *const DsMediaType) -> i32;
        type GetMtFn = unsafe extern "system" fn(*mut core::ffi::c_void, *mut DsMediaType) -> i32;
        type GetBufFn = unsafe extern "system" fn(*mut core::ffi::c_void, *mut i32, *mut u8) -> i32;

        let set_media_type: SetMtFn = std::mem::transmute(*vt.add(4));
        let get_connected_media_type: GetMtFn = std::mem::transmute(*vt.add(5));
        let set_buffer_samples: SetI32Fn = std::mem::transmute(*vt.add(6));
        let get_current_buffer: GetBufFn = std::mem::transmute(*vt.add(7));

        // Accept any video format — we handle conversion below
        let mut mt = DsMediaType::default();
        mt.majortype = MEDIATYPE_VIDEO_GUID;
        set_media_type(grabber_ptr, &mt);

        // Enable continuous buffering (no one-shot — avoids VFW_E_WRONG_STATE)
        set_buffer_samples(grabber_ptr, 1);

        graph.AddFilter(&grabber_filter, windows::core::w!("Grabber"))
            .map_err(|e| format!("DS: AddFilter grabber failed: {e}"))?;

        let null_renderer: IBaseFilter = CoCreateInstance(
            &CLSID_NULL_RENDERER, None, CLSCTX_INPROC_SERVER,
        ).map_err(|e| format!("DS: NullRenderer failed: {e}"))?;
        graph.AddFilter(&null_renderer, windows::core::w!("Null"))
            .map_err(|e| format!("DS: AddFilter null failed: {e}"))?;

        // Build graph
        let builder: ICaptureGraphBuilder2 = CoCreateInstance(
            &CLSID_CAPTURE_GRAPH_BUILDER2, None, CLSCTX_INPROC_SERVER,
        ).map_err(|e| format!("DS: CaptureGraphBuilder2 failed: {e}"))?;
        builder.SetFiltergraph(&graph)
            .map_err(|e| format!("DS: SetFiltergraph failed: {e}"))?;
        builder.RenderStream(
            Some(&PIN_CATEGORY_CAPTURE_GUID),
            &MEDIATYPE_VIDEO_GUID,
            &capture_filter,
            Some(&grabber_filter),
            Some(&null_renderer),
        ).map_err(|e| format!("DS: RenderStream failed: {e}"))?;

        // Run graph
        let control: IMediaControl = graph.cast()
            .map_err(|e| format!("DS: IMediaControl cast failed: {e}"))?;
        control.Run().map_err(|e| format!("DS: Run failed: {e}"))?;

        // Poll for a non-blank frame with STA message pump
        // Virtual cameras (OBS, vMix) need extra time to deliver real frames
        let start = std::time::Instant::now();
        let mut buf_size: i32 = 0;
        let mut buffer: Vec<u8> = Vec::new();
        let mut got_real_frame = false;

        loop {
            // Pump COM/window messages (required for STA DirectShow)
            let mut msg = std::mem::zeroed::<windows::Win32::UI::WindowsAndMessaging::MSG>();
            while windows::Win32::UI::WindowsAndMessaging::PeekMessageW(
                &mut msg, None, 0, 0,
                windows::Win32::UI::WindowsAndMessaging::PM_REMOVE,
            ).as_bool() {
                let _ = windows::Win32::UI::WindowsAndMessaging::TranslateMessage(&msg);
                windows::Win32::UI::WindowsAndMessaging::DispatchMessageW(&msg);
            }

            buf_size = 0;
            let hr = get_current_buffer(grabber_ptr, &mut buf_size, std::ptr::null_mut());
            if hr >= 0 && buf_size > 0 {
                // Read the actual buffer
                buffer.resize(buf_size as usize, 0);
                let hr2 = get_current_buffer(grabber_ptr, &mut buf_size, buffer.as_mut_ptr());
                if hr2 >= 0 {
                    // Check if frame has real content (not all same value)
                    let sample_step = (buffer.len() / 200).max(1);
                    let first = buffer[0];
                    let is_uniform = buffer.iter().step_by(sample_step).all(|&b| b == first);
                    if !is_uniform {
                        got_real_frame = true;
                        break;
                    }
                    // Frame is uniform/blank — keep waiting for a real one
                    if start.elapsed() > std::time::Duration::from_secs(3) {
                        // After 3s, accept whatever we have
                        got_real_frame = true;
                        break;
                    }
                }
            }

            if start.elapsed() > std::time::Duration::from_secs(5) {
                let _ = control.Stop();
                CoUninitialize();
                return Err(format!("DS: Timeout waiting for frame (hr=0x{:08x})", hr as u32));
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }

        if !got_real_frame || buffer.is_empty() {
            let _ = control.Stop();
            CoUninitialize();
            return Err("DS: No frame data received".into());
        }

        // Get connected media type for dimensions and pixel format
        let mut connected_mt = DsMediaType::default();
        let hr = get_connected_media_type(grabber_ptr, &mut connected_mt);
        let _ = control.Stop();

        if hr < 0 || connected_mt.pb_format.is_null() || connected_mt.cb_format < std::mem::size_of::<VideoInfoHeader>() as u32 {
            CoUninitialize();
            return Err("DS: Could not determine video dimensions".into());
        }

        let vih = &*(connected_mt.pb_format as *const VideoInfoHeader);
        let width = vih.bmi_header.width as u32;
        let height = vih.bmi_header.height.unsigned_abs();
        let bit_count = vih.bmi_header.bit_count;
        let compression = vih.bmi_header.compression;
        let bottom_up = vih.bmi_header.height > 0;

        // Release ISampleGrabber
        let release_fn: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32 =
            std::mem::transmute(*vt.add(2));
        release_fn(grabber_ptr);

        eprintln!("[CAMERA] DS format: {}x{} {}bpp compression=0x{:08x} bufsize={}",
            width, height, bit_count, compression, buffer.len());

        // FourCC constants
        const NV12: u32 = u32::from_le_bytes(*b"NV12");
        const I420: u32 = u32::from_le_bytes(*b"I420");
        const YV12: u32 = u32::from_le_bytes(*b"YV12");
        const YUY2: u32 = u32::from_le_bytes(*b"YUY2");
        const UYVY: u32 = u32::from_le_bytes(*b"UYVY");

        let mut img = image::RgbImage::new(width, height);
        let w = width as usize;
        let h = height as usize;

        match compression {
            NV12 => {
                // NV12: Y plane (w*h), then interleaved UV plane (w*h/2)
                let y_plane = &buffer[..w * h];
                let uv_plane = &buffer[w * h..];
                for row in 0..h {
                    let src_row = row; // Planar YUV is always top-down
                    for col in 0..w {
                        let y_val = y_plane[src_row * w + col] as f32;
                        let uv_idx = (src_row / 2) * w + (col & !1);
                        let u_val = uv_plane.get(uv_idx).copied().unwrap_or(128) as f32 - 128.0;
                        let v_val = uv_plane.get(uv_idx + 1).copied().unwrap_or(128) as f32 - 128.0;
                        let r = (y_val + 1.402 * v_val).clamp(0.0, 255.0) as u8;
                        let g = (y_val - 0.344 * u_val - 0.714 * v_val).clamp(0.0, 255.0) as u8;
                        let b = (y_val + 1.772 * u_val).clamp(0.0, 255.0) as u8;
                        img.put_pixel(col as u32, row as u32, image::Rgb([r, g, b]));
                    }
                }
            }
            I420 | YV12 => {
                // I420: Y (w*h), U (w*h/4), V (w*h/4)
                // YV12: Y (w*h), V (w*h/4), U (w*h/4) — swapped
                let y_plane = &buffer[..w * h];
                let uv_size = w * h / 4;
                let (u_plane, v_plane) = if compression == I420 {
                    (&buffer[w * h..w * h + uv_size], &buffer[w * h + uv_size..])
                } else {
                    (&buffer[w * h + uv_size..], &buffer[w * h..w * h + uv_size])
                };
                for row in 0..h {
                    let src_row = row; // Planar YUV is always top-down
                    for col in 0..w {
                        let y_val = y_plane[src_row * w + col] as f32;
                        let uv_idx = (src_row / 2) * (w / 2) + col / 2;
                        let u_val = u_plane.get(uv_idx).copied().unwrap_or(128) as f32 - 128.0;
                        let v_val = v_plane.get(uv_idx).copied().unwrap_or(128) as f32 - 128.0;
                        let r = (y_val + 1.402 * v_val).clamp(0.0, 255.0) as u8;
                        let g = (y_val - 0.344 * u_val - 0.714 * v_val).clamp(0.0, 255.0) as u8;
                        let b = (y_val + 1.772 * u_val).clamp(0.0, 255.0) as u8;
                        img.put_pixel(col as u32, row as u32, image::Rgb([r, g, b]));
                    }
                }
            }
            _ => {
                // RGB/BGR formats based on bit_count
                let bytes_per_pixel = (bit_count / 8) as usize;
                if bytes_per_pixel == 0 {
                    CoUninitialize();
                    return Err(format!("DS: Unsupported format: {}bpp compression=0x{:08x}", bit_count, compression));
                }
                let stride = ((w * bytes_per_pixel + 3) / 4 * 4) as usize;
                for row in 0..h {
                    let src_row = row; // Planar YUV is always top-down
                    for col in 0..w {
                        let offset = src_row * stride + col * bytes_per_pixel;
                        if offset + bytes_per_pixel <= buffer.len() {
                            let (r, g, b) = match bytes_per_pixel {
                                3 => (buffer[offset + 2], buffer[offset + 1], buffer[offset]),
                                4 => (buffer[offset + 2], buffer[offset + 1], buffer[offset]),
                                2 => { // YUY2/UYVY
                                    let luma = buffer[offset];
                                    (luma, luma, luma)
                                }
                                _ => (128, 128, 128),
                            };
                            img.put_pixel(col as u32, row as u32, image::Rgb([r, g, b]));
                        }
                    }
                }
            }
        }

        CoUninitialize();
        eprintln!("[CAMERA] DS capture successful: {}x{} {}bpp bottom_up={}", width, height, bit_count, bottom_up);
        Ok(DynamicImage::ImageRgb8(img))
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
