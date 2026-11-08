"""Downloads mods for the end-to-end test from Modrinth (NeoForge, Minecraft 1.21.1) with their required dependencies.

usage: fetch_mods.py <server_dir> <client_dir> <summary.md> required:create optional:sable optional:irons-spells-n-spellbooks+irons-lib+curios ...
A group joined with "+" is all-or-nothing (for mods whose dependencies Modrinth does not list).
A required group that cannot be fully fetched fails the run; an optional one is reported and skipped.
"""
import json, os, sys, urllib.parse, urllib.request

API = 'https://api.modrinth.com/v2'
HEADERS = {'User-Agent': 'spell-and-iron-rift-e2e-test/1.0'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
        return json.load(r)


def version_for(project):
    q = urllib.parse.urlencode({'loaders': json.dumps(['neoforge']), 'game_versions': json.dumps(['1.21.1'])})
    versions = get(f'{API}/project/{project}/version?{q}')
    releases = [v for v in versions if v['version_type'] == 'release'] or versions
    return releases[0] if releases else None


def resolve(slugs, seen):
    """Returns (files, rows, ok) for a group: every project and its required dependencies."""
    files, rows, ok = [], [], True
    queue = [(s, s) for s in slugs]
    while queue:
        project, asked = queue.pop(0)
        try:
            info = get(f'{API}/project/{project}')
        except Exception as e:
            rows.append(f'| {project} | not on Modrinth ({e}) | — | — |'); ok = False; continue
        if info['id'] in seen:
            continue
        seen.add(info['id'])
        v = version_for(info['id'])
        if v is None:
            rows.append(f"| {info['title']} | no NeoForge 1.21.1 version | — | — |"); ok = False; continue
        f = next((x for x in v['files'] if x['primary']), v['files'][0])
        on_server = info.get('server_side') != 'unsupported'
        on_client = info.get('client_side') != 'unsupported'
        files.append((f, on_server, on_client))
        dep_note = '' if project == asked else f' (dependency of {asked})'
        rows.append(f"| {info['title']}{dep_note} | {v['version_number']} | {'yes' if on_server else 'no'} | {'yes' if on_client else 'no'} |")
        for dep in v.get('dependencies', []):
            if dep.get('dependency_type') != 'required':
                continue
            pid = dep.get('project_id')
            if not pid and dep.get('version_id'):
                try:
                    pid = get(f"{API}/version/{dep['version_id']}")['project_id']
                except Exception:
                    pid = None
            if pid:
                queue.append((pid, asked))
    return files, rows, ok


def main():
    server_dir, client_dir, summary = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(server_dir, exist_ok=True); os.makedirs(client_dir, exist_ok=True)
    seen, lines, failed = set(), ['| Mod | Version | Server | Client |', '|---|---|---|---|'], False
    for arg in sys.argv[4:]:
        kind, group = arg.split(':', 1)
        files, rows, ok = resolve(group.split('+'), seen)
        lines.extend(rows)
        if not ok:
            lines.append(f"| **{group}** | {'missing — the run fails' if kind == 'required' else 'skipped: something is missing for 1.21.1 NeoForge'} | | |")
            failed |= kind == 'required'
            continue
        for f, on_server, on_client in files:
            data = urllib.request.urlopen(urllib.request.Request(f['url'], headers=HEADERS), timeout=300).read()
            for d, wanted in ((server_dir, on_server), (client_dir, on_client)):
                if wanted:
                    open(os.path.join(d, f['filename']), 'wb').write(data)
    with open(summary, 'a') as out:
        out.write('### Mods in the end-to-end test\n\n' + '\n'.join(lines) + '\n\n')
    print('\n'.join(lines))
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
