//! Mobile stand-in for [`super::state`]. There is no git backend on mobile,
//! so there are no cached tokens to hold; the struct exists only so `lib.rs`
//! manages the same state type on every platform.

pub struct SyncState;

impl SyncState {
    pub fn new() -> Self {
        SyncState
    }
}

impl Default for SyncState {
    fn default() -> Self {
        Self::new()
    }
}
