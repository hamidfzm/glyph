use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2Controller, ICoreWebView2Controller2,
    ICoreWebView2EnvironmentOptions, ICoreWebView2Settings, ICoreWebView2Settings3,
    ICoreWebView2Settings6, ICoreWebView2Settings8, ICoreWebView2_3, COREWEBVIEW2_COLOR,
    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS,
};
use webview2_com::{
    take_pwstr, CreateCoreWebView2ControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler, NavigationCompletedEventHandler,
    NavigationStartingEventHandler, NewWindowRequestedEventHandler,
};
use windows::Win32::Foundation::{COLORREF, E_POINTER, HMODULE, HWND, RECT};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows_core::{Interface, HSTRING, PCWSTR, PWSTR};

use crate::hosts::{is_preview_url, APP_HOST, DOCUMENT_HOST, ENTRY_URL};
use crate::APP_IDENTIFIER;

pub struct Config {
    pub web_dir: PathBuf,
    pub document_dir: Option<PathBuf>,
    pub message: String,
    pub bounds: RECT,
    pub background: Option<COLORREF>,
}

/// Starts WebView2 as a child of `parent`; `on_created` runs on this thread
/// once the controller exists (or creation failed). The thread must be in a
/// single-threaded apartment and pump messages: the worker thread is.
pub fn create(
    parent: HWND,
    on_created: impl FnOnce(windows_core::Result<ICoreWebView2Controller>) + 'static,
) -> windows_core::Result<()> {
    let environment_created = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
        move |result, environment| {
            let environment = match result.and_then(|()| environment.ok_or(E_POINTER.into())) {
                Ok(environment) => environment,
                Err(error) => {
                    on_created(Err(error));
                    return Ok(());
                }
            };
            let controller_created = CreateCoreWebView2ControllerCompletedHandler::create(
                Box::new(move |result, controller| {
                    on_created(result.and_then(|()| controller.ok_or(E_POINTER.into())));
                    Ok(())
                }),
            );
            unsafe { environment.CreateCoreWebView2Controller(parent, &controller_created) }
        },
    ));
    let data_dir = HSTRING::from(user_data_dir().as_os_str());
    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR::null(),
            &data_dir,
            None::<&ICoreWebView2EnvironmentOptions>,
            &environment_created,
        )
    }
}

/// Locks the view down, then loads the preview page and hands it the document.
pub fn show(controller: &ICoreWebView2Controller, config: Config) -> windows_core::Result<()> {
    unsafe {
        let webview = controller.CoreWebView2()?;
        lock_down(&webview.Settings()?)?;

        let webview3: ICoreWebView2_3 = webview.cast()?;
        webview3.SetVirtualHostNameToFolderMapping(
            &HSTRING::from(APP_HOST),
            &HSTRING::from(config.web_dir.as_os_str()),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY,
        )?;
        // DENY_CORS: the page may show images from here but cannot fetch() files.
        if let Some(dir) = &config.document_dir {
            webview3.SetVirtualHostNameToFolderMapping(
                &HSTRING::from(DOCUMENT_HOST),
                &HSTRING::from(dir.as_os_str()),
                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS,
            )?;
        }

        let mut token = 0;
        webview.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    if !is_preview_url(&take_pwstr(uri)) {
                        args.SetCancel(true)?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        webview.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetHandled(true)?;
                }
                Ok(())
            })),
            &mut token,
        )?;
        let message = HSTRING::from(config.message);
        webview.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |webview, _| {
                if let Some(webview) = webview {
                    webview.PostWebMessageAsJson(&message)?;
                }
                Ok(())
            })),
            &mut token,
        )?;

        controller.SetBounds(config.bounds)?;
        if let Some(color) = config.background {
            set_background(controller, color)?;
        }
        controller.SetIsVisible(true)?;
        webview.Navigate(&HSTRING::from(ENTRY_URL))
    }
}

/// Paints Explorer's pane color until the page's first paint, so dark mode
/// never flashes white.
pub fn set_background(
    controller: &ICoreWebView2Controller,
    color: COLORREF,
) -> windows_core::Result<()> {
    let [r, g, b, _] = color.0.to_le_bytes();
    let color = COREWEBVIEW2_COLOR {
        A: 255,
        R: r,
        G: g,
        B: b,
    };
    unsafe {
        controller
            .cast::<ICoreWebView2Controller2>()?
            .SetDefaultBackgroundColor(color)
    }
}

fn lock_down(settings: &ICoreWebView2Settings) -> windows_core::Result<()> {
    unsafe {
        settings.SetAreDevToolsEnabled(false)?;
        settings.SetAreDefaultContextMenusEnabled(false)?;
        settings.SetAreDefaultScriptDialogsEnabled(false)?;
        settings.SetAreHostObjectsAllowed(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        settings
            .cast::<ICoreWebView2Settings3>()?
            .SetAreBrowserAcceleratorKeysEnabled(false)?;
        // Newer interfaces: an older runtime lacks them, and the navigation
        // guard and CSP hold without them.
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings6>() {
            settings.SetIsSwipeNavigationEnabled(false)?;
        }
        // SmartScreen would phone home about a page that never navigates away.
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings8>() {
            settings.SetIsReputationCheckingRequired(false)?;
        }
    }
    Ok(())
}

/// The installed page sits next to this DLL: `<install>\preview\web`.
pub fn web_dir() -> windows_core::Result<PathBuf> {
    let mut module = HMODULE::default();
    let mut buffer = vec![0u16; 32_768];
    let len = unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(web_dir as *const u16),
            &mut module,
        )?;
        GetModuleFileNameW(Some(module), &mut buffer) as usize
    };
    if len == 0 {
        return Err(windows_core::Error::from_win32());
    }
    let dll = PathBuf::from(OsString::from_wide(&buffer[..len]));
    Ok(dll.with_file_name("web"))
}

// Its own folder: WebView2 refuses a user data folder another process opened
// with different options, and the app's own webview uses the app's.
fn user_data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_IDENTIFIER)
        .join("PreviewHandler")
}
