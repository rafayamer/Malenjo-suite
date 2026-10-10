use reqwest::{redirect::Policy, Client, Url};
use serde::Serialize;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};
use tauri::AppHandle;

const MAX_HTML_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicHtmlCapture {
    pub url: String,
    pub bytes: Vec<u8>,
    pub content_type: String,
}

fn permitted_public_v4(address: Ipv4Addr) -> bool {
    let n = address.octets();
    let first = n[0];
    // Fail closed on reserved, multicast, private, shared, documentation,
    // benchmark and link-local space. Do not infer "public" from !private.
    !(first == 0 || first == 10 || first == 127 || first >= 224 ||
      (first == 100 && (64..=127).contains(&n[1])) ||
      (first == 169 && n[1] == 254) ||
      (first == 172 && (16..=31).contains(&n[1])) ||
      (first == 192 && (n[1] == 168 || n[1] == 0 || n[1] == 88 ||
                        (n[1] == 0 && n[2] == 2))) ||
      (first == 198 && (n[1] == 18 || n[1] == 19 || n[1] == 51 && n[2] == 100)) ||
      (first == 203 && n[1] == 0 && n[2] == 113) ||
      (first == 192 && n[1] == 0 && n[2] == 2))
}

/// Strict user-supplied HTTPS URL validator. No literal IPs, credentials,
/// custom ports, local/search domains or IDN Unicode interpretation.
fn validate_capture_url(raw: &str) -> Result<(Url, String), String> {
    if raw.trim().is_empty() || raw.len() > 2048 || raw != raw.trim() ||
       raw.chars().any(|ch| ch.is_control()) {
        return Err("Capture URL must be a trimmed HTTPS address within 2,048 characters.".into());
    }
    let url = Url::parse(raw).map_err(|_| "Capture URL is malformed.".to_string())?;
    if url.scheme() != "https" || url.port_or_known_default() != Some(443) ||
       !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("Capture requires HTTPS, port 443, no credentials and no fragment.".into());
    }
    let host = url.host_str().ok_or_else(|| "Capture URL has no hostname.".to_string())?;
    if host.parse::<IpAddr>().is_ok() {
        return Err("URL capture refuses IP literals, including private and loopback hosts.".into());
    }
    if host.len() > 253 || !host.contains('.') || host.starts_with('.') ||
       host.ends_with('.') || host.split('.').any(|label| {
           label.is_empty() || label.len() > 63 ||
           label.starts_with('-') || label.ends_with('-') ||
           !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
       }) {
        return Err("URL capture requires a valid public DNS hostname.".into());
    }
    let denied = [
        ".localhost", ".local", ".internal", ".lan", ".home", ".corp",
        ".test", ".example", ".invalid", ".onion", ".arpa", ".localdomain",
    ];
    if denied.iter().any(|suffix| host.ends_with(suffix)) ||
       host == "localhost" || host == "metadata.google.internal" {
        return Err("Local, private and special-use hostnames are refused.".into());
    }
    Ok((url, host.to_owned()))
}

/// The only network-capable local PDF conversion helper. It is opt-in,
/// HTTPS-only, DNS-pinned to one independently checked IPv4 address, proxiless,
/// redirects disabled and response-bounded. It does not fetch CSS, images,
/// JavaScript, fonts or pages linked inside the HTML.
#[tauri::command]
pub async fn capture_public_https_html(
    _app: AppHandle,
    url: String,
) -> Result<PublicHtmlCapture, String> {
    let (target, hostname) = validate_capture_url(&url)?;
    let mut addresses = tokio::net::lookup_host((hostname.as_str(), 443))
        .await.map_err(|_| "Unable to resolve public HTTPS hostname.".to_string())?;
    let mut public = Vec::new();
    while let Some(address) = addresses.next() {
        match address.ip() {
            IpAddr::V4(ip) if permitted_public_v4(ip) => public.push(ip),
            _ => return Err("DNS resolved to an IPv6, local or reserved address; capture refused.".into()),
        }
        if public.len() > 16 {
            return Err("DNS response exceeds the 16-address capture limit.".into());
        }
    }
    let selected = public.first()
        .ok_or_else(|| "No vetted public IPv4 address was found.".to_string())?;
    let pinned = SocketAddr::new(IpAddr::V4(*selected), 443);
    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .https_only(true)
        .resolve(&hostname, pinned)
        .timeout(Duration::from_secs(20))
        .build().map_err(|_| "Unable to initialize isolated HTTPS capture.".to_string())?;
    let mut response = client.get(target.clone()).send().await
        .map_err(|_| "HTTPS capture could not reach the selected public host.".to_string())?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!("HTML capture requires HTTP 200; received {}.", response.status()));
    }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if !(mime == "text/html" || mime.starts_with("text/html;")) {
        return Err("The captured response is not an HTML document.".into());
    }
    if response.content_length().is_some_and(|n| n > MAX_HTML_BYTES as u64) {
        return Err("HTML response exceeds 1 MB.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await
        .map_err(|_| "Public HTTPS capture was interrupted.".to_string())? {
        if bytes.len() + chunk.len() > MAX_HTML_BYTES {
            return Err("HTML response exceeded 1 MB during streaming.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() || std::str::from_utf8(&bytes).is_err() {
        return Err("Captured HTML must contain valid UTF-8 text.".into());
    }
    Ok(PublicHtmlCapture {
        url: target.to_string(), bytes, content_type: "text/html".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::{permitted_public_v4, validate_capture_url};
    use std::net::Ipv4Addr;
    #[test]
    fn accepts_explicit_public_https_dns_name() {
        let (url, host) = validate_capture_url("https://www.example.com/articles/one").unwrap();
        assert_eq!(host, "www.example.com");
        assert_eq!(url.scheme(), "https");
        assert!(permitted_public_v4(Ipv4Addr::new(8, 8, 8, 8)));
    }
    #[test]
    fn refuses_private_special_ports_credentials_and_redirectable_non_https() {
        for url in [
            "http://www.example.com/", "https://127.0.0.1/",
            "https://169.254.169.254/latest/meta-data", "https://localhost/",
            "https://printer.local/", "https://service.internal/",
            "https://user:password@www.example.com/", "https://www.example.com:8443/",
            "https://www.example.com/#fragment", "https://www.example.com\n",
            "file:///etc/passwd", "https://10.0.0.1/", "https://[::1]/",
        ] {
            assert!(validate_capture_url(url).is_err(), "{url}");
        }
    }
    #[test]
    fn excludes_all_common_private_and_reserved_ipv4_ranges() {
        for ip in [
            [0,0,0,0],[10,0,0,1],[100,64,0,1],[100,127,255,254],
            [127,0,0,1],[169,254,10,20],[172,16,0,2],[172,31,255,255],
            [192,0,0,1],[192,168,1,1],[192,0,2,2],[198,18,0,1],
            [198,19,255,254],[198,51,100,2],[203,0,113,7],[224,0,0,1],
            [255,255,255,255],
        ] {
            assert!(!permitted_public_v4(Ipv4Addr::from(ip)), "{ip:?}");
        }
    }
}
