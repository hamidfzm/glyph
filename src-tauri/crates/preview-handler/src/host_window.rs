use std::sync::Once;

use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::CreateSolidBrush;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, MoveWindow, RegisterClassW, SetParent,
    WINDOW_EX_STYLE, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_VISIBLE,
};
use windows_core::{w, PCWSTR};

use crate::theme::{colorref, surface};
use crate::webview;

const LIGHT: PCWSTR = w!("GlyphPreviewLight");
const DARK: PCWSTR = w!("GlyphPreviewDark");

/// A child of Explorer's preview window, filled with the page's surface color
/// from the moment it exists. WebView2 takes a moment to start, and until it
/// does the pane would otherwise show the preview host's white.
pub fn create(parent: HWND, bounds: RECT, dark: bool) -> windows_core::Result<HWND> {
    let instance = HINSTANCE(webview::module()?.0);
    register_classes(instance);
    let class = if dark { DARK } else { LIGHT };
    unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            PCWSTR::null(),
            WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
            bounds.left,
            bounds.top,
            bounds.right - bounds.left,
            bounds.bottom - bounds.top,
            Some(parent),
            None,
            Some(instance),
            None,
        )
    }
}

pub fn move_to(window: HWND, bounds: RECT) {
    let _ = unsafe {
        MoveWindow(
            window,
            bounds.left,
            bounds.top,
            bounds.right - bounds.left,
            bounds.bottom - bounds.top,
            true,
        )
    };
}

pub fn reparent(window: HWND, parent: HWND) {
    let _ = unsafe { SetParent(window, Some(parent)) };
}

pub fn destroy(window: HWND) {
    let _ = unsafe { DestroyWindow(window) };
}

/// The rect WebView2 fills, relative to this window.
pub fn client(bounds: RECT) -> RECT {
    RECT {
        left: 0,
        top: 0,
        right: bounds.right - bounds.left,
        bottom: bounds.bottom - bounds.top,
    }
}

// One class per theme, since the class brush is what paints the background.
// ponytail: the two brushes live as long as the process, like the classes.
fn register_classes(instance: HINSTANCE) {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| {
        for (class, dark) in [(LIGHT, false), (DARK, true)] {
            let brush = unsafe { CreateSolidBrush(COLORREF(colorref(surface(dark)))) };
            unsafe {
                RegisterClassW(&WNDCLASSW {
                    lpfnWndProc: Some(window_proc),
                    hInstance: instance,
                    lpszClassName: class,
                    hbrBackground: brush,
                    ..Default::default()
                });
            }
        }
    });
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}
