use std::ffi::c_void;

use windows::Win32::Foundation::{CLASS_E_NOAGGREGATION, E_POINTER};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows_core::{implement, Interface, IUnknown, Ref, BOOL, GUID};

use crate::handler::PreviewHandler;

#[implement(IClassFactory)]
pub struct ClassFactory;

impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> windows_core::Result<()> {
        if ppv.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppv = std::ptr::null_mut() };
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let handler: IUnknown = PreviewHandler::default().into();
        unsafe { handler.query(riid, ppv).ok() }
    }

    fn LockServer(&self, _lock: BOOL) -> windows_core::Result<()> {
        Ok(())
    }
}
