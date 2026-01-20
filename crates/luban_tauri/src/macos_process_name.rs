use std::ffi::CString;
use std::os::raw::c_char;

unsafe extern "C" {
    fn setprogname(name: *const c_char);
}

pub fn set_process_name(name: &str) {
    // Best-effort only: if it fails, we keep the OS default.
    let Ok(name) = CString::new(name) else {
        return;
    };
    unsafe {
        setprogname(name.as_ptr());
    }
}
