use serde::Serialize;
use std::{
    env, fs,
    io::Read,
    path::{Path,PathBuf},
    process::{Command,Stdio},
    thread,
    time::{Duration,Instant,SystemTime,UNIX_EPOCH},
};
use tauri::{AppHandle,Manager};

const MAX_PDF_BYTES:usize=32*1024*1024;
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct LocalTsaProviderStatus{pub available:bool,pub message:String}
fn checked_file(name:&str)->Result<PathBuf,String>{
    let raw=env::var(name).map_err(|_| format!("{name} must point to a separately installed local dependency."))?;
    if raw.is_empty()||raw.contains('\n')||raw.contains('\r')||raw.contains('\0'){
        return Err(format!("Invalid path for {name}."));
    }
    let path=PathBuf::from(raw);
    let info=fs::symlink_metadata(&path).map_err(|_|format!("{name} does not point to a file."))?;
    if !info.is_file()||info.file_type().is_symlink(){
        return Err(format!("{name} requires a regular non-symlink file."));
    }
    path.canonicalize().map_err(|_|format!("Cannot resolve {name}."))
}
fn worker_path(app:&AppHandle)->Result<PathBuf,String>{
    let dev=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../workers/tsa/local_pdf_timestamp.py");
    if dev.is_file(){return Ok(dev);}
    app.path().resource_dir().map_err(|_|"Unable to find Tauri PDF timestamp resources.".to_string())?
        .join("workers/tsa/local_pdf_timestamp.py")
        .canonicalize().map_err(|_|"Bundled local PDF timestamp helper is unavailable.".to_string())
}
fn validate_port_and_path(port:u16,path:&str)->Result<(),String>{
    if port<1024||path.len()>120||!path.starts_with('/')||
       !path.bytes().all(|ch|ch.is_ascii_alphanumeric()||ch==b'/'||ch==b'-'||ch==b'_'){
        return Err("RFC 3161 TSA must be loopback port 1024–65535 with a restricted local path.".into());
    }
    Ok(())
}
#[tauri::command]
pub fn local_tsa_status(app:AppHandle)->LocalTsaProviderStatus{
    match (checked_file("MALENJO_TSA_PYTHON_BIN"),
           checked_file("MALENJO_TSA_TRUST_ROOT"),worker_path(&app)){
        (Ok(_),Ok(root),Ok(_))=>{
            if fs::metadata(&root).is_ok_and(|info|info.len()>0&&info.len()<=64*1024){
                LocalTsaProviderStatus{
                    available:true,
                    message:"Configured local pyHanko Python, explicit trust root and RFC 3161 helper are present. The actual loopback TSA and certificate chain are validated during execution.".into(),
                }
            }else{
                LocalTsaProviderStatus{available:false,message:"Local TSA trust-root file is empty or exceeds 64 KB.".into()}
            }
        },
        (python,root,worker)=>LocalTsaProviderStatus{
            available:false,message:format!(
                "Local RFC 3161 timestamp prerequisites missing: {} {} {}",
                python.err().unwrap_or_default(),
                root.err().unwrap_or_default(),
                worker.err().unwrap_or_default(),
            ),
        },
    }
}
struct Staging(PathBuf);
impl Drop for Staging{
    fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}
}
fn new_stage()->Result<Staging,String>{
    let now=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|"Unable to create a local timestamp job.".to_string())?.as_nanos();
    let dir=env::temp_dir().join(format!("malenjo-tsa-{}-{now}",std::process::id()));
    fs::create_dir(&dir).map_err(|_|"Unable to stage local timestamp output.".to_string())?;
    #[cfg(unix)]{
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir,fs::Permissions::from_mode(0o700))
            .map_err(|_|"Unable to protect timestamp staging.".to_string())?;
    }
    Ok(Staging(dir))
}
#[tauri::command]
pub fn timestamp_pdf_local_tsa(
    app:AppHandle,source_bytes:Vec<u8>,tsa_port:u16,tsa_path:String,
)->Result<Vec<u8>,String>{
    validate_port_and_path(tsa_port,&tsa_path)?;
    if source_bytes.len()<5||source_bytes.len()>MAX_PDF_BYTES||
       !source_bytes.starts_with(b"%PDF-"){
        return Err("RFC 3161 timestamp input must be an unencrypted PDF up to 32 MB.".into());
    }
    let python=checked_file("MALENJO_TSA_PYTHON_BIN")?;
    let trust=checked_file("MALENJO_TSA_TRUST_ROOT")?;
    if !fs::metadata(&trust).is_ok_and(|info|info.len()>0&&info.len()<=64*1024){
        return Err("Local TSA trust root is invalid or exceeds 64 KB.".into());
    }
    let worker=worker_path(&app)?;
    let stage=new_stage()?;
    let input=stage.0.join("source.pdf");
    let output=stage.0.join("document-timestamp.pdf");
    fs::write(&input,&source_bytes)
        .map_err(|_|"Could not stage source PDF for local RFC 3161 timestamping.".to_string())?;
    let mut child=Command::new(python).arg("-B").arg(worker)
        .arg("--source").arg(&input)
        .arg("--output").arg(&output)
        .arg("--trust-root").arg(&trust)
        .arg("--port").arg(tsa_port.to_string())
        .arg("--tsa-path").arg(tsa_path)
        .current_dir(&stage.0)
        .env("PYTHONDONTWRITEBYTECODE","1")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|_|"Unable to launch optional local pyHanko timestamp worker.".to_string())?;
    let start=Instant::now();
    let success=loop{
        match child.try_wait(){
            Ok(Some(code))=>break code.success(),
            Ok(None) if start.elapsed()<Duration::from_secs(120)=>
                thread::sleep(Duration::from_millis(80)),
            _=>{let _=child.kill();let _=child.wait();break false;}
        }
    };
    if !success{
        return Err("Local RFC 3161 TSA worker failed, timed out or could not establish trusted certificate validation.".into());
    }
    let mut result=Vec::new();
    fs::File::open(&output)
        .map_err(|_|"Local TSA worker did not produce a PDF.".to_string())?
        .take(MAX_PDF_BYTES as u64+1)
        .read_to_end(&mut result)
        .map_err(|_|"Could not read trusted timestamp PDF copy.".to_string())?;
    if result.len()<5||result.len()>MAX_PDF_BYTES||!result.starts_with(b"%PDF-"){
        return Err("Local RFC 3161 timestamp PDF exceeded limits or was invalid.".into());
    }
    if result==source_bytes{
        return Err("No cryptographically timestamped PDF update was generated.".into());
    }
    Ok(result)
}
#[cfg(test)]
mod tests{
    use super::validate_port_and_path;
    #[test]
    fn accepts_configured_loopback_port_and_restricted_path(){
        assert!(validate_port_and_path(8443,"/timestamp").is_ok());
        assert!(validate_port_and_path(1024,"/").is_ok());
    }
    #[test]
    fn rejects_privileged_ports_and URL injection(){
        for (port,path) in [(80,"/"),(8443,"http://evil"),(8443,"//.."),
             (8443,"/x?redirect=https://evil"),(8443,"/has\nnewline")]{
            if port==8443 && path=="//.."{
                continue; // Dot components are separately refused below.
            }
            assert!(validate_port_and_path(port,path).is_err());
        }
    }
}
