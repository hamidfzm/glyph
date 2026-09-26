// The page's `--color-surface` from src/styles/app.css, as 0xRRGGBB. The
// handler paints it before WebView2 and the page are up, so the pane never
// flashes another color first; a test keeps the two in step.
pub const SURFACE_LIGHT: u32 = 0xffffff;
pub const SURFACE_DARK: u32 = 0x1c1c1e;

pub fn surface(dark: bool) -> u32 {
    if dark {
        SURFACE_DARK
    } else {
        SURFACE_LIGHT
    }
}

/// 0xRRGGBB as a Win32 `COLORREF`, which is 0x00BBGGRR.
pub fn colorref(rgb: u32) -> u32 {
    let [b, g, r, _] = rgb.to_le_bytes();
    u32::from_le_bytes([r, g, b, 0])
}

/// The Windows app theme, which is also what WebView2 reports to the page as
/// `prefers-color-scheme`. Light when the setting is absent.
#[cfg(windows)]
pub fn system_is_dark() -> bool {
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    use windows_core::w;

    let mut light: u32 = 1;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut light as *mut u32 as *mut std::ffi::c_void),
            Some(&mut size),
        )
    };
    status.is_ok() && light == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_surface_for_the_theme() {
        assert_eq!(surface(false), SURFACE_LIGHT);
        assert_eq!(surface(true), SURFACE_DARK);
    }

    #[test]
    fn swaps_red_and_blue_for_a_colorref() {
        assert_eq!(colorref(0x123456), 0x00563412);
        assert_eq!(colorref(SURFACE_DARK), 0x001e1c1c);
        assert_eq!(colorref(SURFACE_LIGHT), 0x00ffffff);
    }
}
