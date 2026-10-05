/// Native security boundary. Private signing keys must never be embedded here or in frontend assets.
pub fn security_baseline() -> &'static [&'static str] {
    &["localhost-only services", "signed updates", "least privilege", "DPAPI/TPM secret wrapping", "integrity checks"]
}
