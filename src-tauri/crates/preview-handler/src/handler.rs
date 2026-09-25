use std::cell::RefCell;
use std::ffi::{c_void, OsString};
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;

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
use crate::hosts::DOCUMENT_BASE_URL;
use crate::webview::{self, Config};
use crate::worker::{Show, Worker};

#[implement(
    IPreviewHandler,
    IPreviewHandlerVisuals,
    IInitializeWithFile,
    IObjectWithSite,
    IOleWindow
)]
#[derive(Default)]
pub struct PreviewHandler {
    state: RefCell<State>,
}

#[derive(Default)]
struct State {
    path: Option<PathBuf>,
    parent: HWND,
    bounds: RECT,
    background: Option<COLORREF>,
    site: Option<IUnknown>,
    // Started on the first preview: the WebView2 thread (see worker.rs).
    worker: Option<Worker>,
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
        let mut state = self.state.borrow_mut();
        state.parent = hwnd;
        state.bounds = bounds;
        if let Some(worker) = &state.worker {
            worker.set_window(hwnd, bounds);
        }
        Ok(())
    }

    fn SetRect(&self, prc: *const RECT) -> windows_core::Result<()> {
        let bounds = rect(prc)?;
        let mut state = self.state.borrow_mut();
        state.bounds = bounds;
        if let Some(worker) = &state.worker {
            worker.set_bounds(bounds);
        }
        Ok(())
    }

    fn DoPreview(&self) -> windows_core::Result<()> {
        let mut state = self.state.borrow_mut();
        let path = state.path.clone().ok_or(E_UNEXPECTED)?;
        let config = Config {
            web_dir: webview::web_dir()?,
            document_dir: path.parent().map(PathBuf::from),
            message: host_message(&path, DOCUMENT_BASE_URL),
            bounds: state.bounds,
            background: state.background,
        };
        if state.worker.is_none() {
            state.worker = Worker::start();
        }
        let worker = state.worker.as_ref().ok_or(E_FAIL)?;
        worker.show(Show {
            parent: state.parent.0 as isize,
            config,
        });
        Ok(())
    }

    fn Unload(&self) -> windows_core::Result<()> {
        let mut state = self.state.borrow_mut();
        state.path = None;
        if let Some(worker) = &state.worker {
            worker.unload();
        }
        Ok(())
    }

    fn SetFocus(&self) -> windows_core::Result<()> {
        if let Some(worker) = &self.state.borrow().worker {
            worker.focus();
        }
        Ok(())
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
        let mut state = self.state.borrow_mut();
        state.background = Some(color);
        if let Some(worker) = &state.worker {
            worker.set_background(color);
        }
        Ok(())
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
