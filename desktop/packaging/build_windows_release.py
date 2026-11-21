"""Run Windows release packaging with stable NSIS compression on CI runners."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


APP_BUILDER_VERSION = '26.18.0'
SEVEN_ZIP_SHA256 = '223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3'


def build(packaging, arch, evidence_path):
    builder = packaging / 'node_modules' / 'app-builder-lib'
    if json.loads((builder / 'package.json').read_bytes())['version'] != APP_BUILDER_VERSION:
        raise ValueError(f'NSIS release compression requires app-builder-lib {APP_BUILDER_VERSION}')

    archive = builder / 'out' / 'targets' / 'archive.js'
    source = archive.read_bytes()
    anchor = b'        if (options.installTimeDecodable) {\n'
    matches = source.count(anchor)
    if matches != 1 or b'"-mmt=' in source:
        raise ValueError(f'Unexpected NSIS archive source, matching lines: {matches}')

    env = os.environ.copy()
    env.pop('ELECTRON_BUILDER_7ZIP_PATH', None)
    resolver = "const {getPath7za}=require('app-builder-lib/out/toolsets/7zip.js'); " \
               "getPath7za().then(p=>console.log('\\nTETHER_7ZA_PATH='+p), e=>{console.error(e);process.exitCode=1});"
    result = subprocess.run(['node', '-e', resolver], cwd=packaging, env=env, stdout=subprocess.PIPE,
                            text=True, encoding='utf-8', check=True, timeout=180)
    marker = 'TETHER_7ZA_PATH='
    paths = [line.removeprefix(marker) for line in result.stdout.splitlines() if line.startswith(marker)]
    if len(paths) != 1:
        raise ValueError('Could not resolve the bundled 7za executable')
    binary = Path(paths[0])
    if not binary.is_absolute() or hashlib.sha256(binary.read_bytes()).hexdigest() != SEVEN_ZIP_SHA256:
        raise ValueError('NSIS release compression requires the bundled 7-Zip 24.09 x86 executable')
    env['ELECTRON_BUILDER_7ZIP_PATH'] = str(binary)

    try:
        # With the original 1 MiB dictionary, four threads reproduce the 0.5.10 public runner's 4 MiB blocks.
        archive.write_bytes(source.replace(anchor, anchor + b'            args.push("-mmt=4");\n', 1))
        evidence = {'app_builder_lib': APP_BUILDER_VERSION, 'seven_zip': '24.09 x86',
                    'seven_zip_executable_sha256': SEVEN_ZIP_SHA256, 'arguments_added': ['-mmt=4'],
                    'matched_source_lines': matches, 'replacement_count': 1, 'runner_logical_cpus': os.cpu_count()}
        print('NSIS release compression: ' + json.dumps(evidence), flush=True)
        subprocess.run(['cmd.exe', '/d', '/c', 'npm.cmd', 'run', 'build:windows', '--', arch],
                       cwd=packaging, env=env, check=True)
    finally:
        archive.write_bytes(source)
    if evidence_path:
        evidence_path.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('arch', choices=('x64', 'arm64'))
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    build(Path(__file__).resolve().parent, args.arch, args.evidence)
