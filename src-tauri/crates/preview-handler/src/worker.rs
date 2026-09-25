use std::cell::RefCell;
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
    pub config: Config,
}

enum Command {
    Show(Box<Show>),
    SetWindow(isize, RECT),
    SetBounds(RECT),
    SetBackground(COLORREF),
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

    pub fn set_background(&self, color: COLORREF) {
        self.send(Command::SetBackground(color));
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

/// The WebView2 state, reachable from its own completion callbacks. Those run
/// from the message loop, never while `handle` holds a borrow.
#[derive(Clone, Default)]
struct View(Rc<RefCell<ViewState>>);

#[derive(Default)]
struct ViewState {
    controller: Option<ICoreWebView2Controller>,
    generation: Generation,
}

impl View {
    /// Returns false once the thread should stop.
    fn handle(&self, command: Command) -> bool {
        match command {
            Command::Show(show) => self.show(*show),
            Command::SetWindow(parent, bounds) => self.with_controller(|controller| unsafe {
                let _ = controller.SetParentWindow(HWND(parent as *mut _));
                let _ = controller.SetBounds(bounds);
            }),
            Command::SetBounds(bounds) => self.with_controller(|controller| {
                let _ = unsafe { controller.SetBounds(bounds) };
            }),
            Command::SetBackground(color) => self.with_controller(|controller| {
                let _ = webview::set_background(controller, color);
            }),
            Command::Focus => self.with_controller(|controller| {
                let _ =
                    unsafe { controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC) };
            }),
            Command::Unload => self.close(),
            Command::Quit => {
                self.close();
                return false;
            }
        }
        true
    }

    fn with_controller(&self, action: impl FnOnce(&ICoreWebView2Controller)) {
        let controller = self.0.borrow().controller.clone();
        if let Some(controller) = controller {
            action(&controller);
        }
    }

    fn show(&self, show: Show) {
        self.close();
        let token = self.0.borrow_mut().generation.advance();
        let view = self.clone();
        let Show { parent, config } = show;
        let started = webview::create(HWND(parent as *mut _), move |created| {
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
        let controller = {
            let mut state = self.0.borrow_mut();
            state.generation.advance();
            state.controller.take()
        };
        if let Some(controller) = controller {
            close(controller);
        }
    }
}

// No borrow is held here: Close can raise WebView2 events synchronously.
fn close(controller: ICoreWebView2Controller) {
    let _ = unsafe { controller.Close() };
}
