#!/usr/bin/env bash
# Synthetic test PKI for MAL-065 (never real identities): a root CA, an RSA and an EC signer, a timestamp authority
# and a CRL. Signers carry a CRL distribution point on 127.0.0.1:47811, which the tests serve themselves.
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/testing/suite/fixtures/signatures/pki"
mkdir -p "$out" && cd "$out"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cat > "$work/ca.cnf" <<'CNF'
[ca]
default_ca = test_ca
[test_ca]
database = index.txt
new_certs_dir = .
serial = serial
crlnumber = crlnumber
default_md = sha256
default_crl_days = 7300
policy = any
[any]
commonName = supplied
[v3_ca]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[signer]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
crlDistributionPoints = URI:http://127.0.0.1:47811/ca.crl
[tsa]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, timeStamping
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
crlDistributionPoints = URI:http://127.0.0.1:47811/ca.crl
CNF
touch "$work/index.txt"; echo 1000 > "$work/serial"; echo 1000 > "$work/crlnumber"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/ca.key" -out ca.pem -days 7300 -subj "/CN=MALENJO Test Root CA/O=MALENJO Tests" -config "$work/ca.cnf" -extensions v3_ca 2>/dev/null
issue() { # name, key args, extensions, subject
  openssl req -new -newkey "$2" -nodes -keyout "$work/$1.key" -out "$work/$1.csr" -subj "$4" 2>/dev/null
  (cd "$work" && openssl ca -batch -config ca.cnf -cert "$out/ca.pem" -keyfile ca.key -in "$1.csr" -out "$out/$1.pem" -days 7300 -extensions "$3" -notext 2>/dev/null)
}
issue signer rsa:2048 signer "/CN=Dana Signer/O=MALENJO Tests"
issue signer-ec ec -pkeyopt ec_paramgen_curve:P-256 signer "/CN=Erin EC Signer/O=MALENJO Tests" 2>/dev/null || {
  openssl ecparam -name prime256v1 -genkey -noout -out "$work/signer-ec.key"
  openssl req -new -key "$work/signer-ec.key" -out "$work/signer-ec.csr" -subj "/CN=Erin EC Signer/O=MALENJO Tests"
  (cd "$work" && openssl ca -batch -config ca.cnf -cert "$out/ca.pem" -keyfile ca.key -in signer-ec.csr -out "$out/signer-ec.pem" -days 7300 -extensions signer -notext 2>/dev/null)
}
issue tsa rsa:2048 tsa "/CN=MALENJO Test TSA/O=MALENJO Tests"
(cd "$work" && openssl ca -batch -config ca.cnf -cert "$out/ca.pem" -keyfile ca.key -gencrl -out "$out/ca.crl.pem" 2>/dev/null)
openssl crl -in ca.crl.pem -outform DER -out ca.crl && rm ca.crl.pem
# Modern PKCS#12 (AES-256-CBC, PBKDF2, SHA-256 MAC), password test-pass.
openssl pkcs12 -export -inkey "$work/signer.key" -in signer.pem -certfile ca.pem -name "Dana Signer" -passout pass:test-pass -out signer.p12
openssl pkcs12 -export -inkey "$work/signer-ec.key" -in signer-ec.pem -certfile ca.pem -name "Erin EC Signer" -passout pass:test-pass -out signer-ec.p12
cp "$work/tsa.key" tsa.key
# A self-signed signer nobody trusts.
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/rogue.key" -out "$work/rogue.pem" -days 7300 -subj "/CN=Untrusted Self-Signed" -addext keyUsage=critical,digitalSignature 2>/dev/null
openssl pkcs12 -export -inkey "$work/rogue.key" -in "$work/rogue.pem" -name "Untrusted" -passout pass:test-pass -out rogue.p12
ls -1 "$out"
