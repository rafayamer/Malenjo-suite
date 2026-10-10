use serde::Serialize;
use std::{
    env, fs,
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_INPUT:usize=32*1024*1024;
const MAX_OUTPUT:usize=32*1024*1024;
const MAX_REPORT:usize=2*1024*1024;

#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct PdfaProviderStatus{pub available:bool,pub message:String}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ValidatedPdfaResult{pub bytes:Vec<u8>,pub profile:String,pub verified:bool}

fn approved_executable(env_name:&str) -> Result<PathBuf,String>{
    let raw=env::var(env_name).map_err(|_| format!("Configure separately installed local {env_name} first."))?;
    if raw.trim().is_empty()||raw.chars().any(|c| c=='\n'||c=='\r'||c=='\0'){
        return Err(format!("{env_name} has an invalid path."));
    }
    let path=PathBuf::from(raw);
    let info=fs::symlink_metadata(&path)
        .map_err(|_| format!("{env_name} does not refer to an installed file."))?;
    if info.file_type().is_symlink()||!info.is_file(){
        return Err(format!("{env_name} must be a regular, non-symbolic-link file."));
    }
    path.canonicalize().map_err(|_| format!("{env_name} could not be canonicalized."))
}
fn validator_command() -> Result<Command,String>{
    if env::var_os("MALENJO_VERAPDF_JAR").is_some(){
        let java=approved_executable("MALENJO_JAVA_BIN")?;
        let jar=approved_executable("MALENJO_VERAPDF_JAR")?;
        if jar.extension().and_then(|x|x.to_str()) != Some("jar"){
            return Err("MALENJO_VERAPDF_JAR must be a real .jar file.".into());
        }
        let mut command=Command::new(java);
        command.arg("-jar").arg(jar);
        Ok(command)
    }else{
        Ok(Command::new(approved_executable("MALENJO_VERAPDF_BIN")?))
    }
}
#[tauri::command]
pub fn pdfa_provider_status()->PdfaProviderStatus{
    let converter=approved_executable("MALENJO_SOFFICE_BIN");
    let validator=validator_command();
    match (converter,validator){
        (Ok(_),Ok(_))=>PdfaProviderStatus{
            available:true,
            message:"A user-configured LibreOffice PDF exporter and independent veraPDF validator are present. Real PDF/A-2b conformance will be checked per output.".into(),
        },
        (a,b)=>PdfaProviderStatus{
            available:false,
            message:format!("PDF/A needs optional local LibreOffice and veraPDF: {} {}",
                a.err().unwrap_or_default(),b.err().unwrap_or_default()),
        },
    }
}
fn verified_pdfa_2b(report:&str)->bool{
    // Only accept a single positively validated PDF/A-2b document. A
    // validator exit code of zero without a matching report is not proof.
    // Require both the item and batch result to agree, including no
    // parsing errors or skipped rules. Unknown report versions fail closed.
    let lower=report.to_ascii_lowercase();
    let count=lower.matches("<validationreport ").count();
    count==1 &&
    lower.contains("profilename=\"pdf/a-2b") &&
    lower.contains("iscompliant=\"true\"") &&
    !lower.contains("iscompliant=\"false\"") &&
    lower.contains("failedrules=\"0\"") &&
    lower.contains("failedchecks=\"0\"") &&
    lower.contains("noncompliant=\"0\"") &&
    lower.contains("failedtoparse=\"0\"") &&
    lower.contains("veraexceptions=\"0\"") &&
    lower.contains("outofmemory=\"0\"") &&
    !lower.contains("encrypted=\"1\"")
}

struct Stage(PathBuf);
impl Drop for Stage{
    fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}
}
fn new_stage()->Result<Stage,String>{
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "Unable to stage PDF/A conversion.".to_string())?.as_nanos();
    let temp=env::temp_dir().join(format!("malenjo-pdfa-{}-{stamp}",std::process::id()));
    fs::create_dir(&temp).map_err(|_| "Unable to prepare unique PDF/A conversion directory.".to_string())?;
    #[cfg(unix)]{
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp,fs::Permissions::from_mode(0o700))
            .map_err(|_| "Unable to protect PDF/A staging directory.".to_string())?;
    }
    Ok(Stage(temp))
}
fn run_bounded(mut command:Command,limit:Duration)->Result<bool,String>{
    let mut child:Child=command.stdin(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|_| "Unable to launch locally configured PDF/A provider.".to_string())?;
    let begin=Instant::now();
    loop{
        match child.try_wait(){
            Ok(Some(status))=>return Ok(status.success()),
            Ok(None) if begin.elapsed()<limit=>thread::sleep(Duration::from_millis(100)),
            _=>{
                let _=child.kill();let _=child.wait();
                return Err("PDF/A provider timed out or became unresponsive.".into());
            }
        }
    }
}
#[tauri::command]
pub fn convert_validated_pdfa_2b(source_bytes:Vec<u8>)->Result<ValidatedPdfaResult,String>{
    if source_bytes.len()<5||source_bytes.len()>MAX_INPUT||!source_bytes.starts_with(b"%PDF-"){
        return Err("PDF/A input must be a real PDF of at most 32 MB.".into());
    }
    if source_bytes.windows(10).any(|bytes|bytes==b"/ByteRange")||
       source_bytes.windows(8).any(|bytes|bytes==b"/Encrypt"){
        return Err("Signed and encrypted PDFs cannot be rewritten as PDF/A by this conversion route.".into());
    }
    let soffice=approved_executable("MALENJO_SOFFICE_BIN")?;
    let stage=new_stage()?;
    let incoming=stage.0.join("input");
    let outgoing=stage.0.join("output");
    fs::create_dir(&incoming).map_err(|_| "Unable to create PDF/A input folder.".to_string())?;
    fs::create_dir(&outgoing).map_err(|_| "Unable to create PDF/A output folder.".to_string())?;
    let input=incoming.join("source.pdf");
    let output=outgoing.join("source.pdf");
    fs::write(&input,&source_bytes).map_err(|_| "Unable to stage PDF/A source document.".to_string())?;
    let mut convert=Command::new(soffice);
    convert.arg("--headless")
        .arg("--convert-to")
        .arg(r#"pdf:draw_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}"#)
        .arg("--outdir").arg(&outgoing)
        .arg(&input).stdout(Stdio::null());
    if !run_bounded(convert,Duration::from_secs(120))?{
        return Err("LibreOffice PDF/A conversion failed. Source PDF was preserved.".into());
    }
    let metadata=fs::metadata(&output).map_err(|_| "LibreOffice did not write a PDF/A candidate.".to_string())?;
    if metadata.len()<5||metadata.len()>MAX_OUTPUT as u64 {
        return Err("PDF/A candidate is empty or exceeds the 32 MB limit.".into());
    }
    // Crucial release contract: a PDF/A export flag is NOT proof of compliance.
    // Validate the actual output against the PDF/A-2b rule profile offline.
    let validator_output=stage.0.join("validation.xml");
    let stdout=fs::File::create(&validator_output)
        .map_err(|_| "Unable to create independent PDF/A validation report.".to_string())?;
    let mut validate=validator_command()?;
    validate.arg("--format").arg("xml").arg("--flavour").arg("2b")
        .arg(&output).stdout(Stdio::from(stdout));
    if !run_bounded(validate,Duration::from_secs(120))?{
        return Err("Independent veraPDF validation failed; no PDF/A output is released.".into());
    }
    if fs::metadata(&validator_output).map_err(|_| "veraPDF did not write a conformance report.".to_string())?.len()>MAX_REPORT as u64{
        return Err("PDF/A validation report exceeded the 2 MB analysis limit.".into());
    }
    let report=fs::read_to_string(&validator_output)
        .map_err(|_| "veraPDF conformance report is not readable UTF-8.".to_string())?;
    if !verified_pdfa_2b(&report){
        return Err("veraPDF did not verify PDF/A-2b compliance. No PDF/A copy is released.".into());
    }
    let mut bytes=Vec::new();
    fs::File::open(&output).map_err(|_| "PDF/A candidate disappeared.".to_string())?
        .take(MAX_OUTPUT as u64 + 1).read_to_end(&mut bytes)
        .map_err(|_| "Unable to read validated PDF/A result.".to_string())?;
    if bytes.len()<5||bytes.len()>MAX_OUTPUT||!bytes.starts_with(b"%PDF-"){
        return Err("Validated PDF/A output failed PDF header/size validation.".into());
    }
    Ok(ValidatedPdfaResult{bytes,profile:"PDF/A-2b".into(),verified:true})
}
#[cfg(test)]
mod tests{
    use super::verified_pdfa_2b;
    #[test]
    fn rejects_false_or_missing_conformance_regardless_of_process_exit(){
        assert!(!verified_pdfa_2b("<validationReport isCompliant=\"false\"/>"));
        assert!(!verified_pdfa_2b("<report><validationReport profileName=\"PDF/A-1b\" isCompliant=\"true\"/></report>"));
        assert!(!verified_pdfa_2b("<report><validationReports compliant=\"1\"/></report>"));
        assert!(!verified_pdfa_2b("<validationReport isCompliant=\"true\"/><validationReport isCompliant=\"false\"/>"));
    }
    #[test]
    fn accepts_one_true_independent_validation_result(){
        assert!(verified_pdfa_2b("<report><validationReport profileName=\"PDF/A-2b validation profile\" isCompliant=\"true\"><details failedRules=\"0\" failedChecks=\"0\"/></validationReport><batchSummary failedToParse=\"0\" nonCompliant=\"0\" veraExceptions=\"0\" outOfMemory=\"0\"/></report>"));
    }
}
