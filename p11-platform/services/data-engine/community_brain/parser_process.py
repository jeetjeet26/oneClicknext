"""Parser process entrypoint. The parent supplies no database or model credentials."""
import ctypes
import ctypes.util
import json
import os
import resource
import socket
import sys
from pathlib import Path


def restrict_parser():
    resource.setrlimit(resource.RLIMIT_CPU, (180, 185))
    resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024 * 1024, 24 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    if sys.platform == 'linux':
        resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
        # Block native networking, including in OCR/video subprocesses; no credential-bearing env is inherited.
        library = ctypes.util.find_library('seccomp')
        if not library:
            raise RuntimeError('Parser network sandbox unavailable')
        seccomp = ctypes.CDLL(library)
        seccomp.seccomp_init.argtypes = [ctypes.c_uint32]; seccomp.seccomp_init.restype = ctypes.c_void_p
        seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]; seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
        seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
        seccomp.seccomp_load.argtypes = [ctypes.c_void_p]; seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
        context = seccomp.seccomp_init(0x7FFF0000)
        if not context:
            raise RuntimeError('Parser sandbox initialization failed')
        try:
            for name in ('socket', 'connect', 'sendto', 'sendmsg', 'socketpair'):
                number = seccomp.seccomp_syscall_resolve_name(name.encode())
                if number >= 0 and seccomp.seccomp_rule_add(context, 0x00050001, number, 0) != 0:
                    raise RuntimeError('Parser sandbox rule failed')
            if seccomp.seccomp_load(context) != 0:
                raise RuntimeError('Parser sandbox activation failed')
        finally:
            seccomp.seccomp_release(context)
    elif os.environ.get('BRAIN_PARSER_SANDBOX_REQUIRED') == 'true':
        raise RuntimeError('Production parsers require the qualified Linux sandbox')
    def denied(*_args, **_kwargs):
        raise PermissionError('Parser networking is disabled')
    socket.socket = denied
    socket.create_connection = denied


def main():
    directory = Path(sys.argv[1]).resolve()
    request = json.loads((directory / 'request.json').read_text())
    restrict_parser()
    from community_brain.processors import process_original
    receipt = process_original((directory / 'original').read_bytes(), request['fileName'], request['mimeType'], request['byteHash'], directory / 'output')
    (directory / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
