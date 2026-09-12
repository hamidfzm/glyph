//! `glyph mcp`: the vault index served to an MCP client over stdio.
//!
//! [`registry`] is the transport-agnostic half, a tool list and a dispatch any
//! caller can drive in-process. [`stdio`] is the adapter that exists today,
//! and the only code on this path that writes to stdout.

mod launch;
mod link_tools;
mod note_tools;
mod refs;
mod registry;
mod session;
mod stdio;
mod vault_tools;

#[cfg(test)]
mod tests;

use std::cell::RefCell;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use crate::grants::GrantRegistry;
use crate::vault::VaultStore;
use registry::Session;

/// Serve until the client closes `input`, and return the exit code. `vaults`
/// are the `--vault` roots, already checked to be folders, and all the server
/// reads. With none, it serves the vaults open in the app, and an agent can ask
/// the user for more. `stores` is where the app keeps its session; `None` is
/// its own data directory.
pub fn run(
    vaults: Vec<String>,
    stores: Option<PathBuf>,
    input: impl BufRead,
    output: impl Write,
) -> i32 {
    let grants = GrantRegistry::default();
    for root in &vaults {
        let _ = grants.grant_workspace(Path::new(root));
    }
    let store = VaultStore::default();
    let exe = launcher(std::env::var_os("APPIMAGE"));
    // Folders the user let the agent add, served until the session ends.
    let mut allowed: Vec<String> = Vec::new();

    let served = stdio::serve(input, output, |name, args, ask| {
        let mut open = session::open_state(&vaults, &grants, stores.as_deref());
        with_allowed(&mut open, &allowed, &grants);
        // `--vault` names every folder the session may read.
        let can_ask = vaults.is_empty() && ask.can_ask();
        let ask = RefCell::new(ask);
        let added = RefCell::new(Vec::new());
        let allow_vault = |root: &str| -> Result<(), String> {
            ask.borrow_mut().confirm(&format!(
                "An agent asks to read the folder \"{root}\". Allow it until this session ends? It could then read every note in that folder, and save exported documents there, replacing files of the same name."
            ))?;
            added.borrow_mut().push(root.to_string());
            Ok(())
        };
        let session = Session {
            grants: &grants,
            vaults: &store,
            open: &open,
            exe: &exe,
            allow_vault: can_ask.then_some(&allow_vault),
        };
        let result = registry::dispatch(name, args, &session);
        allowed.extend(added.take());
        result
    });
    match served {
        Ok(()) => 0,
        // A client that exits mid-reply is how a session usually ends.
        Err(err) if err.kind() == io::ErrorKind::BrokenPipe => 0,
        Err(err) => {
            eprintln!("glyph mcp: {err}");
            1
        }
    }
}

/// List the folders the user allowed this session, each once however the app
/// spells it.
fn with_allowed(open: &mut session::OpenState, allowed: &[String], grants: &GrantRegistry) {
    for root in allowed {
        let wanted = grants.ensure_workspace(root).ok();
        let listed = wanted.is_some()
            && open
                .roots
                .iter()
                .any(|listed| grants.ensure_workspace(listed).ok() == wanted);
        if !listed {
            open.roots.push(root.clone());
        }
    }
}

/// The binary `open_in_glyph` and `export` start. Run from an AppImage, that is
/// the AppImage itself: the binary inside it lives in a mount that goes away
/// when this process ends, taking a Glyph started from it along.
fn launcher(appimage: Option<std::ffi::OsString>) -> PathBuf {
    match appimage {
        Some(appimage) => PathBuf::from(appimage),
        None => std::env::current_exe().unwrap_or_else(|_| PathBuf::from(crate::APP_NAME)),
    }
}

/// Windows gives a child every inheritable handle its parent holds, not only
/// the ones set as its stdio. The pipes a client hands this process are
/// inheritable, so a Glyph that `open_in_glyph` starts would keep the client's
/// stdout open after this process exits, and the client would wait forever for
/// the end of the stream.
#[cfg(windows)]
pub fn keep_stdio_from_children() {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::raw::HANDLE;

    const HANDLE_FLAG_INHERIT: u32 = 0x0000_0001;
    extern "system" {
        fn SetHandleInformation(handle: HANDLE, mask: u32, flags: u32) -> i32;
    }
    for handle in [
        io::stdin().as_raw_handle(),
        io::stdout().as_raw_handle(),
        io::stderr().as_raw_handle(),
    ] {
        // SAFETY: these are this process's own standard handles, and clearing
        // the flag on a null or closed one fails without effect.
        unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) };
    }
}
