#!/usr/bin/env python3
"""Opt-in, local-only RFC 3161 document timestamp PDF worker.

No external URL may be supplied: the only permitted authority is a user-run
RFC 3161 TSA on 127.0.0.1. Certificate trust is explicitly pinned to a
local operator-supplied PEM/DER trust root and revocation fetching is off.
The resulting PDF must contain a cryptographically trusted document timestamp.
"""
from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
from urllib.parse import urlsplit


async def timestamp(source: Path, output: Path, trust_root: Path, port: int, tsa_path: str):
    import aiohttp
    from pyhanko.keys import load_cert_from_pemder
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.signers import PdfTimeStamper
    from pyhanko.sign.timestamps import AIOHttpTimeStamper
    from pyhanko.sign.validation import async_validate_pdf_timestamp
    from pyhanko_certvalidator import ValidationContext

    endpoint = f"http://127.0.0.1:{port}{tsa_path}"
    # Restrict every HTTP request, even if a malicious local service
    # requests a redirect, and never honor the user's HTTP proxy variables.
    class LocalOnlySession(aiohttp.ClientSession):
        async def _request(self, method, url, **kwargs):
            parsed = urlsplit(str(url))
            if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                    or parsed.port != port or parsed.path != tsa_path
                    or parsed.username is not None or parsed.password is not None):
                raise RuntimeError("TSA attempted a non-approved loopback request.")
            kwargs["allow_redirects"] = False
            return await super()._request(method, url, **kwargs)

    timeout = aiohttp.ClientTimeout(total=25, connect=8)
    connector = aiohttp.TCPConnector(family=2, limit=1, ssl=False)
    async with LocalOnlySession(connector=connector, timeout=timeout, trust_env=False) as session:
        stamper = AIOHttpTimeStamper(url=endpoint, session=session)
        with source.open("rb") as input_file, output.open("wb") as output_file:
            await PdfTimeStamper(timestamper=stamper).async_timestamp_pdf(
                IncrementalPdfFileWriter(input_file),
                md_algorithm="sha256",
                output=output_file,
            )

    # A returned timestamp token alone is not evidence of trust. Verify the
    # embedded RFC 3161 document timestamp, imprint, signature and chain to
    # the explicitly configured offline operator root.
    root_certificate = load_cert_from_pemder(str(trust_root))
    validation = ValidationContext(
        trust_roots=[root_certificate],
        allow_fetching=False,
        revocation_mode="soft-fail",
    )
    with output.open("rb") as result_stream:
        reader = PdfFileReader(result_stream)
        stamps = [
            sig for sig in reader.embedded_signatures
            if str(sig.sig_object.get("/SubFilter")) == "/ETSI.RFC3161"
        ]
        if not stamps:
            raise RuntimeError("Output PDF has no RFC 3161 document timestamp.")
        result = await async_validate_pdf_timestamp(
            stamps[-1], validation_context=validation
        )
        if not (result.intact and result.valid and result.trusted):
            raise RuntimeError("Document timestamp failed trusted-chain or digest validation.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--trust-root", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--tsa-path", type=str, required=True)
    args = parser.parse_args()
    if not (1024 <= args.port <= 65535):
        raise ValueError("Invalid local TSA port.")
    if not args.tsa_path.startswith("/") or any(
        char not in "/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
        for char in args.tsa_path
    ) or len(args.tsa_path) > 120:
        raise ValueError("Invalid local TSA endpoint path.")
    if args.source.resolve() == args.output.resolve():
        raise ValueError("Cannot overwrite the original PDF.")
    if not args.trust_root.is_file():
        raise ValueError("Trusted TSA root certificate is missing.")
    asyncio.run(timestamp(args.source, args.output, args.trust_root, args.port, args.tsa_path))


if __name__ == "__main__":
    main()
