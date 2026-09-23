use std::cell::RefCell;
use std::ffi::{c_void, OsString};
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::rc::Rc;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC,
};
use windows::Win32::Foundation::{
    COLORREF, ERROR_ALREADY_INITIALIZED, E_FAIL, E_NOTIMPL, E_POINTER, E_UNEXPECTED, HWND, RECT,
    S_FALSE,
};
use windows::Win32::Graphics::Gdi::LOGFONTW;
use windows::Win32::System::Ole::{
    IObjectWithSite, IObjectWithSite_Impl, IOleWindow, IOleWindow_Impl,
};
use windows::Win32::UI::Input::KeyboardAndMouse::GetFocus;
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithFile, IInitializeWithFile_Impl};
use windows::Win32::UI::Shell::{
    IPreviewHandler, IPreviewHandlerVisuals, IPreviewHandlerVisuals_Impl, IPreviewHandler_Impl,
};
use windows::Win32::UI::WindowsAndMessaging::MSG;
use windows_core::{implement, IUnknown, Interface, Ref, BOOL, GUID, HRESULT, PCWSTR};

use crate::document::host_message;
use crate::generation::Generation;
use crate::hosts::DOCUMENT_BASE_URL;
use crate::webview::{self, Config};

#[implement(
    IPreviewHandler,
    IPreviewHandlerVisuals,
    IInitializeWithFile,
    IObjectWithSite,
    IOleWindow
)]
#[derive(Default)]
pub struct PreviewHandler {
    // Shared with WebView2's completion callbacks, which outlive a call.
    state: Rc<RefCell<State>>,
}

#[derive(Default)]
struct State {
    path: Option<PathBuf>,
    parent: HWND,
    bounds: RECT,
    background: Option<COLORREF>,
    site: Option<IUnknown>,
    controller: Option<ICoreWebView2Controller>,
    generation: Generation,
}

// Calls into WebView2 happen with no `state` borrow held: they can raise events
// synchronously, and a callback that re-borrows would panic.
fn close(controller: Option<ICoreWebView2Controller>) {
    if let Some(controller) = controller {
        let _ = unsafe { controller.Close() };
    }
}

fn rect(prc: *const RECT) -> windows_core::Result<RECT> {
    unsafe { prc.as_ref() }.copied().ok_or(E_POINTER.into())
}

impl IInitializeWithFile_Impl for PreviewHandler_Impl {
    fn Initialize(&self, path: &PCWSTR, _mode: u32) -> windows_core::Result<()> {
        let mut state = self.state.borrow_mut();
        if state.path.is_some() {
            return Err(HRESULT::from_win32(ERROR_ALREADY_INITIALIZED.0).into());
        }
        let path = OsString::from_wide(unsafe { path.as_wide() });
        state.path = Some(PathBuf::from(path));
        Ok(())
    }
}

impl IPreviewHandler_Impl for PreviewHandler_Impl {
    fn SetWindow(&self, hwnd: HWND, prc: *const RECT) -> windows_core::Result<()> {
        let bounds = rect(prc)?;
        let controller = {
            let mut state = self.state.borrow_mut();
            state.parent = hwnd;
            state.bounds = bounds;
            state.controller.clone()
        };
        if let Some(controller) = controller {
            unsafe {
                controller.SetParentWindow(hwnd)?;
                controller.SetBounds(bounds)?;
            }
        }
        Ok(())
    }

    fn SetRect(&self, prc: *const RECT) -> windows_core::Result<()> {
        let bounds = rect(prc)?;
        let controller = {
            let mut state = self.state.borrow_mut();
            state.bounds = bounds;
            state.controller.clone()
        };
        if let Some(controller) = controller {
            unsafe { controller.SetBounds(bounds)? };
        }
        Ok(())
    }

    fn DoPreview(&self) -> windows_core::Result<()> {
        let (token, parent, path) = {
            let mut state = self.state.borrow_mut();
            let path = state.path.clone().ok_or(E_UNEXPECTED)?;
            (state.generation.advance(), state.parent, path)
        };
        let message = host_message(&path, DOCUMENT_BASE_URL);
        let document_dir = path.parent().map(PathBuf::from);
        let web_dir = webview::web_dir()?;
        let state = Rc::clone(&self.state);
        webview::create(parent, move |created| {
            let Ok(controller) = created else { return };
            let config = {
                let state = state.borrow();
                state.generation.is_current(token).then(|| Config {
                    web_dir,
                    document_dir,
                    message,
                    bounds: state.bounds,
                    background: state.background,
                })
            };
            let Some(config) = config else {
                close(Some(controller));
                return;
            };
            if webview::show(&controller, config).is_err() {
                close(Some(controller));
                return;
            }
            let previous = state.borrow_mut().controller.replace(controller);
            close(previous);
        })
    }

    fn Unload(&self) -> windows_core::Result<()> {
        let controller = {
            let mut state = self.state.borrow_mut();
            state.generation.advance();
            state.path = None;
            state.controller.take()
        };
        close(controller);
        Ok(())
    }

    fn SetFocus(&self) -> windows_core::Result<()> {
        let controller = self.state.borrow().controller.clone();
        match controller {
            Some(controller) => unsafe {
                controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)
            },
            None => Ok(()),
        }
    }

    fn QueryFocus(&self) -> windows_core::Result<HWND> {
        let focused = unsafe { GetFocus() };
        if focused.is_invalid() {
            return Err(E_FAIL.into());
        }
        Ok(focused)
    }

    // ponytail: never handled here. Keystrokes go to WebView2's own window, and
    // its browser shortcuts are off; forward to IPreviewHandlerFrame if Tab
    // navigation out of the pane is ever needed.
    fn TranslateAccelerator(&self, _msg: *const MSG) -> windows_core::Result<()> {
        Err(S_FALSE.into())
    }
}

impl IPreviewHandlerVisuals_Impl for PreviewHandler_Impl {
    fn SetBackgroundColor(&self, color: COLORREF) -> windows_core::Result<()> {
        let controller = {
            let mut state = self.state.borrow_mut();
            state.background = Some(color);
            state.controller.clone()
        };
        match controller {
            Some(controller) => webview::set_background(&controller, color),
            None => Ok(()),
        }
    }

    // The page styles text with the app's own theme.
    fn SetFont(&self, _font: *const LOGFONTW) -> windows_core::Result<()> {
        Ok(())
    }

    fn SetTextColor(&self, _color: COLORREF) -> windows_core::Result<()> {
        Ok(())
    }
}

impl IObjectWithSite_Impl for PreviewHandler_Impl {
    fn SetSite(&self, site: Ref<'_, IUnknown>) -> windows_core::Result<()> {
        self.state.borrow_mut().site = site.cloned();
        Ok(())
    }

    fn GetSite(&self, riid: *const GUID, ppv: *mut *mut c_void) -> windows_core::Result<()> {
        if ppv.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppv = std::ptr::null_mut() };
        match &self.state.borrow().site {
            Some(site) => unsafe { site.query(riid, ppv).ok() },
            None => Err(E_FAIL.into()),
        }
    }
}

impl IOleWindow_Impl for PreviewHandler_Impl {
    fn GetWindow(&self) -> windows_core::Result<HWND> {
        let parent = self.state.borrow().parent;
        if parent.is_invalid() {
            return Err(E_FAIL.into());
        }
        Ok(parent)
    }

    fn ContextSensitiveHelp(&self, _enter_mode: BOOL) -> windows_core::Result<()> {
        Err(E_NOTIMPL.into())
    }
}
