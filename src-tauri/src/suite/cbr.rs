use serde::Serialize;
use std::{
    env, fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zip::ZipArchive;

const MAX_INPUT_ZIP: usize = 32 * 1024 * 1024;
const MAX_RAR_OUTPUT: usize = 32 * 1024 * 1024;
const MAX_PAGES: usize = 20;
const MAX_TOTAL_PNG: usize = 30 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCbrWriterStatus {
    pub available: bool,
    pub message: String,
}
fn configured_rar_executable() -> Result<PathBuf, String> {
    let selected=env::var("MALENJO_RAR_BIN")
        .map_err(|_| "Configure a separately licensed local Rar.exe using MALENJO_RAR_BIN; MALENJO does not bundle a RAR writer.".to_string())?;
    if selected.trim().is_empty() || selected.contains('\n') || selected.contains('\0') {
        return Err("Configured RAR executable path is invalid.".into());
    }
    let path=PathBuf::from(selected);
    let metadata=fs::symlink_metadata(&path)
        .map_err(|_| "The configured RAR writer does not exist.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("RAR writer must be a real regular file, not a symlink.".into());
    }
    path.canonicalize().map_err(|_| "RAR writer path could not be resolved.".to_string())
}
#[tauri::command]
pub fn rar_cbr_status() -> LocalCbrWriterStatus {
    match configured_rar_executable() {
        Ok(_) => LocalCbrWriterStatus {
            available:true,
            message:"A user-configured external RAR executable is present; actual archive operation and license still require verification.".into(),
        },
        Err(message) => LocalCbrWriterStatus {available:false,message},
    }
}
fn valid_page_png_filename(value:&str, number:usize) -> bool {
    value==format!("page-{number:04}.png")
}
fn rar_header(bytes:&[u8]) -> bool {
    bytes.starts_with(b"Rar!\x1a\x07\x00") ||
       bytes.starts_with(b"Rar!\x1a\x07\x01\x00")
}
struct TemporaryArchiveDirectory(PathBuf);
impl Drop for TemporaryArchiveDirectory {
    fn drop(&mut self) {
        let _=fs::remove_dir_all(&self.0);
    }
}
fn private_temp_directory() -> Result<TemporaryArchiveDirectory,String> {
    let nonce=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "Unable to create local RAR job token.".to_string())?.as_nanos();
    let path=env::temp_dir().join(format!("malenjo-cbr-{}-{nonce}",std::process::id()));
    fs::create_dir(&path)
        .map_err(|_| "Unable to create a unique private RAR staging folder.".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path,fs::Permissions::from_mode(0o700))
            .map_err(|_| "Unable to protect RAR temporary folder.".to_string())?;
    }
    Ok(TemporaryArchiveDirectory(path))
}
fn run_rar(
    program:&Path,args:&[String],directory:&Path,timeout:Duration,
) -> Result<bool,String> {
    let mut child=Command::new(program).args(args).current_dir(directory)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|_| "Unable to launch configured local RAR executable.".to_string())?;
    let begin=Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(result)) => return Ok(result.success()),
            Ok(None) if begin.elapsed()<timeout=>thread::sleep(Duration::from_millis(60)),
            _=>{
                let _=child.kill();
                let _=child.wait();
                return Err("RAR job failed or exceeded its 90 second deadline.".into());
            }
        }
    }
}
#[tauri::command]
pub fn rar_create_cbr_from_png_zip(zip_bytes:Vec<u8>) -> Result<Vec<u8>,String>{
    if zip_bytes.len()<30||zip_bytes.len()>MAX_INPUT_ZIP{
        return Err("PDF-to-CBR source PNG ZIP must be 1–32 MB.".into());
    }
    let executable=configured_rar_executable()?;
    let mut archive=ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|_| "PDF-to-CBR input is not a valid PNG ZIP archive.".to_string())?;
    if archive.is_empty()||archive.len()>MAX_PAGES{
        return Err("CBR conversion supports 1 to 20 PNG pages.".into());
    }
    let dir=private_temp_directory()?;
    let mut files=Vec::new();
    let mut total=0usize;
    for number in 1..=archive.len(){
        let mut file=archive.by_index(number-1)
            .map_err(|_| "Unable to inspect PNG ZIP member.".to_string())?;
        if file.is_dir()||!valid_page_png_filename(file.name(),number)||
            file.size()>MAX_TOTAL_PNG as u64{
            return Err("PNG ZIP must contain consecutive page-0001.png members only; no extra paths.".into());
        }
        total=total.checked_add(file.size() as usize)
            .ok_or_else(|| "PNG archive size overflow.".to_string())?;
        if total>MAX_TOTAL_PNG {
            return Err("PNG pages exceed the 30 MB CBR staging limit.".into());
        }
        let name=file.name().to_owned();
        let mut bytes=Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|_| "PNG ZIP member is corrupt.".to_string())?;
        if bytes.len()<57||!bytes.starts_with(b"\x89PNG\r\n\x1a\n"){
            return Err("RAR staging input includes an invalid PNG.".into());
        }
        let file_path=dir.0.join(&name);
        let mut dest=fs::OpenOptions::new().create_new(true).write(true)
            .open(file_path).map_err(|_| "Could not create the PNG staging file.".to_string())?;
        dest.write_all(&bytes).map_err(|_| "Unable to stage PNG page safely.".to_string())?;
        files.push(name);
    }
    drop(archive);
    let mut args=vec![
        "a".to_string(),"-ma5".to_string(),"-m0".to_string(),
        "-ep".to_string(),"-idq".to_string(),"-o-".to_string(),
        "output.cbr".to_string(),
    ];
    args.extend(files);
    if !run_rar(&executable,&args,&dir.0,Duration::from_secs(90))? {
        return Err("Configured RAR writer could not create a genuine CBR archive.".into());
    }
    let target=dir.0.join("output.cbr");
    let content=fs::read(&target).map_err(|_| "RAR writer did not produce a CBR archive.".to_string())?;
    if content.len()<32||content.len()>MAX_RAR_OUTPUT||!rar_header(&content){
        return Err("CBR output is not a bounded genuine RAR4/RAR5 archive.".into());
    }
    if !run_rar(&executable,&["t".into(),"-inul".into(),"output.cbr".into()],
        &dir.0,Duration::from_secs(60))?{
        return Err("CBR integrity test failed; no result was returned.".into());
    }
    Ok(content)
}
#[cfg(test)]
mod tests{
    use super::{rar_header,valid_page_png_filename};
    #[test]
    fn recognizes_only_genuine_rar_container_headers(){
        assert!(rar_header(b"Rar!\x1a\x07\x01\x00something"));
        assert!(rar_header(b"Rar!\x1a\x07\x00something"));
        assert!(!rar_header(b"PK\x03\x04zip is not a CBR"));
        assert!(!rar_header(b"%PDF-1.7"));
    }
    #[test]
    fn enforces_only_ordered_pages_not_paths_or_comic_executable(){
        assert!(valid_page_png_filename("page-0001.png",1));
        assert!(!valid_page_png_filename("../page-0001.png",1));
        assert!(!valid_page_png_filename("page-0002.png",1));
        assert!(!valid_page_png_filename("payload.exe",1));
    }
}
