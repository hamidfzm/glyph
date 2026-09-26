//! Windows Explorer preview handler for markdown files: a COM in-proc server
//! that Explorer's `prevhost.exe` surrogate loads to render the selected file
//! with WebView2. Registered by the MSI (`src-tauri/windows/preview-handler.wxs`).

// Only the platform-independent pieces build (and are tested) off Windows.
#[cfg(any(windows, test))]
mod document;
#[cfg(any(windows, test))]
mod generation;
#[cfg(any(windows, test))]
mod hosts;
#[cfg(any(windows, test))]
mod theme;

#[cfg(windows)]
mod class_factory;
#[cfg(windows)]
mod handler;
#[cfg(windows)]
mod host_window;
#[cfg(windows)]
mod webview;
#[cfg(windows)]
mod worker;

/// The handler's COM class id; the WiX fragment registers the same value.
pub const CLSID_TEXT: &str = "D0BF6AA3-FB9F-473F-BDEF-ABB364324298";

/// The app's bundle identifier (`tauri.conf.json`); WebView2 data lives under it.
pub const APP_IDENTIFIER: &str = "com.hamidfzm.glyph";

#[cfg(windows)]
mod exports {
    use std::ffi::c_void;

    use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, E_POINTER, S_FALSE};
    use windows::Win32::System::Com::IClassFactory;
    use windows_core::{Interface, GUID, HRESULT};

    use crate::class_factory::ClassFactory;

    const CLSID: GUID = GUID::from_u128(0xD0BF6AA3_FB9F_473F_BDEF_ABB364324298);

    /// # Safety
    /// COM entry point: `rclsid` and `riid` point to valid GUIDs, `ppv` to writable storage.
    #[no_mangle]
    pub unsafe extern "system" fn DllGetClassObject(
        rclsid: *const GUID,
        riid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> HRESULT {
        if rclsid.is_null() || riid.is_null() || ppv.is_null() {
            return E_POINTER;
        }
        unsafe {
            *ppv = std::ptr::null_mut();
            if *rclsid != CLSID {
                return CLASS_E_CLASSNOTAVAILABLE;
            }
            let factory: IClassFactory = ClassFactory.into();
            factory.query(riid, ppv)
        }
    }

    // ponytail: never unload. WebView2 holds callback objects implemented in
    // this DLL until its async work finishes; prevhost.exe exits when idle anyway.
    #[no_mangle]
    pub extern "system" fn DllCanUnloadNow() -> HRESULT {
        S_FALSE
    }

    #[cfg(test)]
    #[test]
    fn clsid_constants_agree() {
        assert_eq!(format!("{CLSID:?}"), super::CLSID_TEXT);
    }
}

#[cfg(test)]
mod tests;
