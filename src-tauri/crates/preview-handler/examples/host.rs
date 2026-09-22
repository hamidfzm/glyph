//! Hosts the built preview handler in a plain window, the way Explorer's
//! prevhost.exe does, so it can be exercised without Explorer:
//!
//!   pnpm build:preview-handler
//!   cargo run -p glyph-preview-handler --example host -- path\to\file.md
//!
//! It loads `dist-preview/glyph_preview_handler.dll`, the same file the MSI ships.
//!
//! With `--surrogate` it instead activates the registered CLSID out of process,
//! which is what Explorer does: the handler runs inside prevhost.exe, so this
//! reproduces registration and surrogate failures the direct load cannot.

#[cfg(windows)]
fn main() -> windows_core::Result<()> {
    host::run()
}

#[cfg(not(windows))]
fn main() {}

#[cfg(windows)]
mod host {
    use std::ffi::c_void;
    use std::path::PathBuf;

    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IClassFactory, CLSCTX_INPROC_SERVER,
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows::Win32::UI::Shell::PropertiesSystem::IInitializeWithFile;
    use windows::Win32::UI::Shell::IPreviewHandler;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW,
        PostQuitMessage, RegisterClassW, TranslateMessage, CW_USEDEFAULT, MSG, WINDOW_EX_STYLE,
        WM_DESTROY, WNDCLASSW, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };
    use windows_core::{s, w, Interface, GUID, HRESULT, HSTRING};

    const CLSID: GUID = GUID::from_u128(0xD0BF6AA3_FB9F_473F_BDEF_ABB364324298);

    type GetClassObject =
        unsafe extern "system" fn(*const GUID, *const GUID, *mut *mut c_void) -> HRESULT;

    extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_DESTROY {
            unsafe { PostQuitMessage(0) };
            return LRESULT(0);
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    pub fn run() -> windows_core::Result<()> {
        let args: Vec<String> = std::env::args().collect();
        let surrogate = args.iter().any(|arg| arg == "--surrogate");
        let inproc = args.iter().any(|arg| arg == "--inproc");
        let clsid = match args.iter().position(|arg| arg == "--clsid") {
            Some(at) => {
                let digits: String =
                    args[at + 1].chars().filter(|c| c.is_ascii_hexdigit()).collect();
                GUID::from_u128(u128::from_str_radix(&digits, 16).expect("a CLSID"))
            }
            None => CLSID,
        };
        // The file is always last: `--clsid` takes a value of its own.
        let file = args.last().filter(|arg| !arg.starts_with("--")).cloned();
        let file = file.expect("usage: host [--surrogate|--inproc] [--clsid <guid>] <file.md>");
        // Not canonicalize: Explorer passes plain paths, and WebView2 cannot
        // serve subfolders of a `\\?\` verbatim folder mapping.
        let file = std::path::absolute(file).expect("valid path");
        let dll = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../dist-preview/glyph_preview_handler.dll");

        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let handler: IPreviewHandler = if surrogate || inproc {
                let context = if inproc { CLSCTX_INPROC_SERVER } else { CLSCTX_LOCAL_SERVER };
                println!("activating {clsid:?} with {context:?}");
                CoCreateInstance(&clsid, None, context)
                    .inspect_err(|error| println!("CoCreateInstance failed: {error}"))?
            } else {
                let module = LoadLibraryW(&HSTRING::from(dll.as_os_str()))?;
                let get_class_object: GetClassObject =
                    std::mem::transmute(GetProcAddress(module, s!("DllGetClassObject")).unwrap());
                let mut factory: Option<IClassFactory> = None;
                get_class_object(&CLSID, &IClassFactory::IID, &mut factory as *mut _ as *mut _)
                    .ok()?;
                factory.unwrap().CreateInstance(None)?
            };

            RegisterClassW(&WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                lpszClassName: w!("GlyphPreviewHost"),
                ..Default::default()
            });
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("GlyphPreviewHost"),
                &HSTRING::from(format!("Preview: {}", file.display())),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                900,
                700,
                None,
                None,
                None,
                None,
            )?;
            let mut bounds = RECT::default();
            GetClientRect(hwnd, &mut bounds)?;

            handler
                .cast::<IInitializeWithFile>()
                .inspect_err(|error| println!("QI IInitializeWithFile failed: {error}"))?
                .Initialize(&HSTRING::from(file.as_os_str()), 0)
                .inspect_err(|error| println!("Initialize failed: {error}"))?;
            handler
                .SetWindow(hwnd, &bounds)
                .inspect_err(|error| println!("SetWindow failed: {error}"))?;
            handler
                .DoPreview()
                .inspect_err(|error| println!("DoPreview failed: {error}"))?;
            println!("preview started");

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            handler.Unload()
        }
    }
}
