use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc::{channel, Receiver, Sender};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC,
};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, PeekMessageW, PostQuitMessage, PostThreadMessageW,
    TranslateMessage, MSG, PM_NOREMOVE, WM_APP,
};

use crate::generation::Generation;
use crate::host_window;
use crate::theme::{colorref, surface, system_is_dark};
use crate::webview::{self, Config};

/// Explorer calls the handler on a thread in the multithreaded apartment,
/// where WebView2 will not start (it needs a single-threaded one, and
/// `CoInitializeEx` cannot convert a thread that already has an apartment).
/// WebView2 therefore lives on this thread, which owns an STA and pumps the
/// messages its callbacks arrive on. The handler talks to it by command.
pub struct Worker {
    commands: Sender<Command>,
    thread_id: u32,
}

pub struct Show {
    /// `HWND` is not `Send`, so the window crosses the thread as a number.
    pub parent: isize,
    pub bounds: RECT,
    pub web_dir: PathBuf,
    pub document_dir: Option<PathBuf>,
    pub message: String,
}

enum Command {
    Show(Box<Show>),
    SetWindow(isize, RECT),
    SetBounds(RECT),
    Focus,
    Unload,
    Quit,
}

// Only wakes the message loop; the work itself travels on the channel.
const WAKE: u32 = WM_APP + 1;

impl Worker {
    pub fn start() -> Option<Self> {
        let (commands, receiver) = channel();
        let (ready, started) = channel();
        std::thread::spawn(move || run(&receiver, &ready));
        // A message posted before the thread's queue exists is lost, so wait
        // for the thread to report in.
        let thread_id = started.recv().ok()?;
        Some(Self {
            commands,
            thread_id,
        })
    }

    pub fn show(&self, show: Show) {
        self.send(Command::Show(Box::new(show)));
    }

    pub fn set_window(&self, parent: HWND, bounds: RECT) {
        self.send(Command::SetWindow(parent.0 as isize, bounds));
    }

    pub fn set_bounds(&self, bounds: RECT) {
        self.send(Command::SetBounds(bounds));
    }

    pub fn focus(&self) {
        self.send(Command::Focus);
    }

    pub fn unload(&self) {
        self.send(Command::Unload);
    }

    fn send(&self, command: Command) {
        if self.commands.send(command).is_ok() {
            let _ = unsafe { PostThreadMessageW(self.thread_id, WAKE, WPARAM(0), LPARAM(0)) };
        }
    }
}

// Not joined: closing WebView2 can send messages to the preview window, whose
// thread may be the one dropping us, and a join there would deadlock.
impl Drop for Worker {
    fn drop(&mut self) {
        self.send(Command::Quit);
    }
}

fn run(commands: &Receiver<Command>, ready: &Sender<u32>) {
    let mut message = MSG::default();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        // Creates this thread's message queue.
        let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
        if ready.send(GetCurrentThreadId()).is_err() {
            return;
        }
    }
    let view = View::default();
    loop {
        while let Ok(command) = commands.try_recv() {
            if !view.handle(command) {
                unsafe { PostQuitMessage(0) };
            }
        }
        if unsafe { GetMessageW(&mut message, None, 0, 0) }.0 <= 0 {
            return;
        }
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

/// The preview's windows, reachable from WebView2's completion callbacks.
/// Those run from the message loop, never while `handle` holds a borrow.
#[derive(Clone, Default)]
struct View(Rc<RefCell<ViewState>>);

#[derive(Default)]
struct ViewState {
    /// Painted in the page's surface color while WebView2 starts inside it.
    host: Option<HWND>,
    controller: Option<ICoreWebView2Controller>,
    generation: Generation,
}

impl View {
    /// Returns false once the thread should stop.
    fn handle(&self, command: Command) -> bool {
        match command {
            Command::Show(show) => self.show(*show),
            Command::SetWindow(parent, bounds) => {
                if let Some(host) = self.0.borrow().host {
                    host_window::reparent(host, HWND(parent as *mut _));
                }
                self.resize(bounds);
            }
            Command::SetBounds(bounds) => self.resize(bounds),
            Command::Focus => {
                if let Some(controller) = self.controller() {
                    let _ = unsafe {
                        controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)
                    };
                }
            }
            Command::Unload => self.close(),
            Command::Quit => {
                self.close();
                return false;
            }
        }
        true
    }

    fn controller(&self) -> Option<ICoreWebView2Controller> {
        self.0.borrow().controller.clone()
    }

    fn resize(&self, bounds: RECT) {
        if let Some(host) = self.0.borrow().host {
            host_window::move_to(host, bounds);
        }
        if let Some(controller) = self.controller() {
            let _ = unsafe { controller.SetBounds(host_window::client(bounds)) };
        }
    }

    fn show(&self, show: Show) {
        self.close();
        let dark = system_is_dark();
        let Ok(host) = host_window::create(HWND(show.parent as *mut _), show.bounds, dark) else {
            return;
        };
        let token = {
            let mut state = self.0.borrow_mut();
            state.host = Some(host);
            state.generation.advance()
        };
        let config = Config {
            web_dir: show.web_dir,
            document_dir: show.document_dir,
            message: show.message,
            bounds: host_window::client(show.bounds),
            background: COLORREF(colorref(surface(dark))),
        };
        let view = self.clone();
        let started = webview::create(host, move |created| {
            let Ok(controller) = created else { return };
            // A newer file, or Unload, got here first (INV-3).
            if !view.0.borrow().generation.is_current(token) {
                close(controller);
                return;
            }
            if webview::show(&controller, config).is_err() {
                close(controller);
                return;
            }
            view.0.borrow_mut().controller = Some(controller);
        });
        if started.is_err() {
            self.0.borrow_mut().generation.advance();
        }
    }

    fn close(&self) {
        let (controller, host) = {
            let mut state = self.0.borrow_mut();
            state.generation.advance();
            (state.controller.take(), state.host.take())
        };
        if let Some(controller) = controller {
            close(controller);
        }
        if let Some(host) = host {
            host_window::destroy(host);
        }
    }
}

// No borrow is held here: Close can raise WebView2 events synchronously.
fn close(controller: ICoreWebView2Controller) {
    let _ = unsafe { controller.Close() };
}
