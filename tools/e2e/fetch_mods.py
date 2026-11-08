"""Downloads mods for the end-to-end test from Modrinth (NeoForge, Minecraft 1.21.1) with their required dependencies.

usage: fetch_mods.py <server_dir> <client_dir> <summary.md> required:create optional:sable optional:irons-spells-n-spellbooks ...
A required mod that has no 1.21.1 NeoForge version fails the run; an optional one is reported and skipped.
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

def main():
    server_dir, client_dir, summary = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(server_dir, exist_ok=True); os.makedirs(client_dir, exist_ok=True)
    wanted = [a.split(':', 1) for a in sys.argv[4:]]
    seen, lines, failed = set(), ['| Mod | Version | Server | Client |', '|---|---|---|---|'], False
    queue = [(slug, kind == 'required', slug) for kind, slug in wanted]
    while queue:
        project, required, asked = queue.pop(0)
        try:
            info = get(f'{API}/project/{project}')
        except Exception as e:
            lines.append(f'| {project} | not on Modrinth ({e}) | — | — |'); failed |= required; continue
        if info['id'] in seen: continue
        seen.add(info['id'])
        v = version_for(info['id'])
        if v is None:
            lines.append(f"| {info['title']} | no NeoForge 1.21.1 version | — | — |"); failed |= required; continue
        f = next((x for x in v['files'] if x['primary']), v['files'][0])
        on_server = info.get('server_side') != 'unsupported'
        on_client = info.get('client_side') != 'unsupported'
        data = urllib.request.urlopen(urllib.request.Request(f['url'], headers=HEADERS), timeout=300).read()
        for d, ok in ((server_dir, on_server), (client_dir, on_client)):
            if ok:
                open(os.path.join(d, f['filename']), 'wb').write(data)
        lines.append(f"| {info['title']}{'' if project == asked else ' (dependency of ' + asked + ')'} | {v['version_number']} | {'yes' if on_server else 'no'} | {'yes' if on_client else 'no'} |")
        for dep in v.get('dependencies', []):
            if dep.get('dependency_type') == 'required' and dep.get('project_id'):
                queue.append((dep['project_id'], required, asked))
    with open(summary, 'a') as out:
        out.write('### Mods in the end-to-end test\n\n' + '\n'.join(lines) + '\n\n')
    print('\n'.join(lines))
    if failed: sys.exit(1)

if __name__ == '__main__':
    main()
