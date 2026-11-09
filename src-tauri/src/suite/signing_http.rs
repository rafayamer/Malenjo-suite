//! Network requests PDF signing needs (MAL-065): RFC 3161 timestamp queries to the timestamp authority the user
//! names, and certificate revocation lists from the addresses in certificates. Only http and https, no credentials
//! in the address, a short timeout and a size limit; the replies are parsed and verified in the app.
use reqwest::{header::CONTENT_TYPE, redirect::Policy, Client, Url};
use std::time::Duration;

const MAX_REPLY_BYTES: usize = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 64 * 1024;

fn checked_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "The address is not valid.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https addresses can be used for timestamps and revocation lists.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Addresses with a user name or password are not allowed.".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn pdf_signing_http(method: String, url: String, body: Option<Vec<u8>>, content_type: Option<String>) -> Result<Vec<u8>, String> {
    let url = checked_url(&url)?;
    let client = Client::builder()
        .redirect(Policy::limited(3))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("The network is not available: {error}"))?;
    let request = match method.as_str() {
        "GET" => client.get(url.clone()),
        "POST" => {
            let body = body.unwrap_or_default();
            if body.len() > MAX_REQUEST_BYTES {
                return Err("The request is too large.".into());
            }
            let kind = content_type.unwrap_or_else(|| "application/timestamp-query".into());
            if kind != "application/timestamp-query" {
                return Err("Only timestamp queries can be sent.".into());
            }
            client.post(url.clone()).header(CONTENT_TYPE, kind).body(body)
        }
        _ => return Err("Only GET and POST are supported.".into()),
    };
    let response = request.send().await.map_err(|error| format!("{} could not be reached: {error}", url.host_str().unwrap_or("The server")))?;
    if !response.status().is_success() {
        return Err(format!("{} answered {}.", url.host_str().unwrap_or("The server"), response.status()));
    }
    if response.content_length().map(|n| n as usize > MAX_REPLY_BYTES).unwrap_or(false) {
        return Err("The reply is too large.".into());
    }
    let bytes = response.bytes().await.map_err(|error| format!("The reply could not be read: {error}"))?;
    if bytes.len() > MAX_REPLY_BYTES {
        return Err("The reply is too large.".into());
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::checked_url;

    #[test]
    fn only_plain_http_addresses_are_accepted() {
        assert!(checked_url("https://freetsa.org/tsr").is_ok());
        assert!(checked_url("http://crl.example.com/ca.crl").is_ok());
        assert!(checked_url("file:///etc/passwd").is_err());
        assert!(checked_url("ftp://example.com/x").is_err());
        assert!(checked_url("https://user:secret@example.com/").is_err());
        assert!(checked_url("not a url").is_err());
    }
}
