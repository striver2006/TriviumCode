"""只读重建官方源码检索证据，不解压执行上游文件，不修改 native。"""
import hashlib
import argparse
import io
import json
import pathlib
import re
import sys
import tarfile
import time
import urllib.request

DEFAULT_COMMIT = 'ec495f0cb00f6db9a9118bf979112886f4264a41'


def parse_cli(argv=None):
    def commit(value):
        if not re.fullmatch(r'[0-9a-fA-F]{40}', value):
            raise argparse.ArgumentTypeError('commit must be an exact 40-character hexadecimal SHA')
        return value.lower()

    parser = argparse.ArgumentParser(description='按固定官方commit重建只读源码检索证据，不执行上游代码')
    parser.add_argument('output', nargs='?', default='doc/05_testing/evidence/kimi-macos-20261028')
    parser.add_argument('--commit', type=commit, default=DEFAULT_COMMIT)
    return parser.parse_args(argv)


def main():
    args = parse_cli()
    URL = 'https://api.github.com/repos/moonshotai/kimi-code/tarball/' + args.commit
    data = urllib.request.urlopen(URL, timeout=60).read()
    archive = tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')
    files = {m.name.split('/', 1)[1]: archive.extractfile(m).read()
             for m in archive.getmembers() if m.isfile() and '/src/' in m.name and m.name.endswith('.ts')}
    patterns = [r'\.addRules\s*\(', r'PermissionRulesAdd', r'permission\.rules\.add',
                r'\bPERMISSION_SECTION\b', r'permissionRulesKey',
                r'(?:get|inspect|resolve)\s*(?:<[^>]+>)?\s*\(\s*[\'\"]permission[\'\"]',
                r'(?:rulesService|permissionRules)\.(?:rules|addRules)', r'permissionRules\s*:',
                r'config[^\n]*\.rules', r'config[^\n]*[Pp]ermission']
    searches = []
    for pattern in patterns:
        hits = []
        for name, body in sorted(files.items()):
            text = body.decode('utf8', errors='replace')
            for m in re.finditer(pattern, text):
                line = text.count('\n', 0, m.start()) + 1
                hits.append({'path': name, 'line': line, 'text': text.splitlines()[line - 1]})
        searches.append({'regex': pattern, 'flags': 'none; whole file including newlines', 'hits': hits})
    suffixes = ['agentLifecycle/agentLifecycleService.ts', 'permissionRules/configSection.ts',
                'permissionRules/permissionRulesOps.ts', 'permissionRules/permissionRulesService.ts',
                'permissionPolicy/policies/user-configured-rule.ts', 'permissionPolicy/permissionPolicyService.ts']
    bodies = []
    for name, body in sorted(files.items()):
        if any(name.endswith(suffix) for suffix in suffixes):
            lines = body.decode().splitlines()
            if name.endswith('agentLifecycleService.ts'):
                start = next(i for i, l in enumerate(lines) if 'private async bindBootstrap' in l)
                excerpt = [{'line': i + 1, 'text': lines[i]} for i in range(start, min(start + 16, len(lines)))]
            else:
                excerpt = [{'line': i + 1, 'text': l} for i, l in enumerate(lines)]
            bodies.append({'path': name, 'sha256': hashlib.sha256(body).hexdigest(), 'excerpts': excerpt})
    result = {'schema': 'trivium.kimi-source-search.v1', 'commit': args.commit, 'url': URL,
              'tarball_sha256': hashlib.sha256(data).hexdigest(),
              'script_sha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(), 'typescript_src_files': len(files),
              'scope': 'all tarball src/**/*.ts; excludes tests/generated/binary; regex absence is bounded evidence',
              'searches': searches, 'files': bodies, 'not_binary_equivalence_proof': True}
    root = pathlib.Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    target = root / ('official-search-' + args.commit[:8] + '-' + str(time.time_ns()) + '.json')
    with target.open('x') as out:
        json.dump(result, out, ensure_ascii=False, indent=2)
        out.write('\n')
    target.chmod(0o600)
    print(json.dumps({'file': str(target), 'files_scanned': len(files), 'patterns': len(patterns)}))


if __name__ == '__main__':
    main()
