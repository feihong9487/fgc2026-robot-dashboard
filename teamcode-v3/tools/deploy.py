#!/usr/bin/env python3
r"""
FGC 2026 OnBot Java 一鍵部署：把 teamcode-v3 底下的 .java（含 dash\、vision\ 子資料夾）
上傳到 Control Hub 並 Build。

用法：
  python tools\deploy.py --base http://192.168.43.1:8080            # 筆電直連 Control Hub Wi-Fi
  python tools\deploy.py --base http://127.0.0.1:18080              # 經 adb → Driver Hub nc 中繼
  python tools\deploy.py --dry-run                                  # 只列出會做什麼
  python tools\deploy.py --no-build                                 # 只上傳不編譯
  python tools\deploy.py --move                                     # 檔案搬進子資料夾後，把 Hub 根目錄的舊副本刪掉

安全規則（對應「先備份、不亂刪、不影響檢錄」）：
  1. Hub 上的 /java/file/tree 必須包含 FGC 的原始檔（DriveSystem/ShooterSystem/...），否則拒絕動作（避免傳錯台）。
  2. 會被覆蓋或刪除的既有檔案先抓回本機 backup\<時間戳>\ 再動。
  3. 只新增與覆寫 .java、只建 teamcode 底下的子資料夾；不碰 ExternalLibraries、不碰硬體組態。
     刪除只在 --move 時發生，而且只刪「本機已搬進子資料夾、Hub 根目錄還留著同名副本」的那幾支
     （沒刪的話同一個 class 會有兩份，Build 直接失敗）。
  4. 上傳後逐檔回讀比對 md5，不一致就停止不 Build。

OnBotJava 端點（RC 11.x）：
  GET  /java/file/tree                       → {"src": ["/org/…/X.java", …], …}
  GET  /java/file/get?f=/src/org/…/X.java
  POST /java/file/save?f=/src/org/…/X.java   body data=<內容>
  POST /java/file/new?f=/src/org/…/dash/     body new=1            （尾巴的 / = 建資料夾）
  POST /java/file/delete                     body delete=["/src/org/…/X.java"]   （只給檔案，絕不給資料夾）
  rename 只能同資料夾內改名，不能搬移，所以搬移 = 新位置 save + 舊位置 delete。
"""
import argparse, hashlib, json, os, sys, time, urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(HERE, '..'))
PKG = '/src/org/firstinspires/ftc/teamcode/'
REQUIRED_ON_HUB = ['DriveSystem.java', 'ShooterSystem.java', 'IntakeSystem.java', 'ClimbSystem.java', 'HopperSystem.java', 'Constants.java']
SKIP = {'out', 'tools', 'backup', '.git'}


def http(base, path, data=None, timeout=20):
    url = base + path
    if data is not None:
        body = urllib.parse.urlencode(data).encode('utf-8')
        req = urllib.request.Request(url, data=body, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8')
    else:
        req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def md5_text(b):
    return hashlib.md5(b.replace(b'\r\n', b'\n')).hexdigest()


def local_files():
    """回傳 [(相對路徑 'dash/DashHub.java' 或 'Constants.java', 絕對路徑)]，跳過 out/tools/backup。"""
    out = []
    for root, dirs, files in os.walk(SRC_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP and not d.startswith('.')]
        for f in files:
            if f.endswith('.java'):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, SRC_DIR).replace('\\', '/')
                out.append((rel, full))
    return sorted(out)


def read_tree(base):
    st, body = http(base, '/java/file/tree')
    tree = json.loads(body.decode('utf-8'))
    on_hub = set()
    for k, files in tree.items():
        for f in files:
            on_hub.add('/' + k + f)
    return on_hub


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://192.168.43.1:8080')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-build', action='store_true')
    ap.add_argument('--move', action='store_true', help='刪掉 Hub 根目錄裡「本機已搬進子資料夾」的舊副本（先備份）')
    ap.add_argument('--only', nargs='*', help='只上傳這些檔名（不含資料夾）')
    a = ap.parse_args()
    base = a.base.rstrip('/')

    # 1. 讀 Hub 檔案樹 + 安全檢查
    on_hub = read_tree(base)
    hub_java = {p for p in on_hub if p.endswith('.java')}
    hub_names = {p.rsplit('/', 1)[-1] for p in hub_java}
    missing = [n for n in REQUIRED_ON_HUB if n not in hub_names]
    if missing:
        print('[停止] 這台 Hub 的 OnBotJava 沒有 FGC 原始檔:', missing)
        print('        Hub 上現有:', sorted(hub_names))
        print('        請確認 Driver Hub 配對的是 FGC 的 Control Hub。')
        sys.exit(2)

    # 2. 本機檔案清單
    local = local_files()
    if a.only:
        only = set(a.only)
        local = [(rel, full) for rel, full in local if rel.rsplit('/', 1)[-1] in only]
    print(f'Hub: {base}  本機: {SRC_DIR}  檔案: {len(local)}')

    ts = time.strftime('%Y%m%d-%H%M%S')
    bdir = os.path.join(SRC_DIR, 'backup', ts, 'onbotjava-before-deploy')

    # 需要的子資料夾（Hub 上 tree 會列成 '/src/org/.../dash/'）
    need_dirs = sorted({rel.rsplit('/', 1)[0] for rel, _ in local if '/' in rel})
    new_dirs = [d for d in need_dirs if (PKG + d + '/') not in on_hub]

    plan = []
    for rel, full in local:
        remote = PKG + rel
        exists = remote in hub_java
        with open(full, 'rb') as fh:
            content = fh.read()
        if exists:
            st, cur = http(base, '/java/file/get?f=' + urllib.parse.quote(remote))
            same = md5_text(cur) == md5_text(content)
            plan.append((rel, 'SAME' if same else 'OVERWRITE', content, cur))
        else:
            plan.append((rel, 'NEW', content, None))

    # 搬移：本機在子資料夾、Hub 根目錄還有同名舊副本
    stale = []
    for rel, _ in local:
        if '/' in rel:
            old = PKG + rel.rsplit('/', 1)[-1]
            if old in hub_java:
                stale.append(old)
    # Hub 上有、本機沒有的（只列出，不動）
    local_remote = {PKG + rel for rel, _ in local}
    hub_only = sorted(p for p in hub_java if p.startswith(PKG) and p not in local_remote and p not in stale)

    for d in new_dirs:
        print(f'  MKDIR     {d}/')
    for rel, act, _, _ in plan:
        print(f'  {act:9s} {rel}')
    for p in stale:
        print(f'  {"DELETE" if a.move else "STALE":9s} {p[len(PKG):]}   (舊位置的副本{"，--move 會刪" if not a.move else ""})')
    for p in hub_only:
        print(f'  {"KEEP":9s} {p[len(PKG):]}   (只在 Hub 上，不動)')
    if stale and not a.move:
        print('[注意] Hub 根目錄還有舊副本，同名 class 兩份會讓 Build 失敗；加 --move 才會刪（會先備份）。')
    if a.dry_run:
        print('[dry-run] 未做任何變更')
        return

    # 3. 備份會被覆蓋／刪除的檔案
    to_backup = [(rel, cur) for rel, act, _, cur in plan if act == 'OVERWRITE']
    if a.move:
        for p in stale:
            st, cur = http(base, '/java/file/get?f=' + urllib.parse.quote(p))
            to_backup.append((p[len(PKG):], cur))
    if to_backup:
        for rel, cur in to_backup:
            dst = os.path.join(bdir, rel.replace('/', os.sep))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as fh:
                fh.write(cur)
        print(f'已備份 {len(to_backup)} 支會被覆蓋／刪除的檔案到 {bdir}')

    # 4. 建子資料夾
    for d in new_dirs:
        st, body = http(base, '/java/file/new?f=' + urllib.parse.quote(PKG + d + '/'), data={'new': '1'})
        if st != 200:
            print(f'[錯誤] 建資料夾 {d}/ 回 HTTP {st}: {body[:200]!r}')
            sys.exit(3)
        print(f'  建資料夾 {d}/')

    # 5. 上傳（NEW 與 OVERWRITE；SAME 跳過）
    uploaded = 0
    for rel, act, content, _ in plan:
        if act == 'SAME':
            continue
        remote = PKG + rel
        st, body = http(base, '/java/file/save?f=' + urllib.parse.quote(remote), data={'data': content.decode('utf-8')}, timeout=60)
        if st != 200:
            print(f'[錯誤] 上傳 {rel} 回 HTTP {st}: {body[:200]!r}')
            sys.exit(3)
        uploaded += 1
        print(f'  上傳 {rel} ({len(content)} bytes)')

    # 6. 回讀比對
    bad = []
    for rel, act, content, _ in plan:
        remote = PKG + rel
        st, cur = http(base, '/java/file/get?f=' + urllib.parse.quote(remote))
        if md5_text(cur) != md5_text(content):
            bad.append(rel)
    if bad:
        print('[錯誤] 回讀不一致，未 Build:', bad)
        sys.exit(4)
    print(f'回讀比對全部一致（{len(plan)} 支）；本次上傳 {uploaded} 支')

    # 7. 刪舊副本（只有 --move；只刪檔案，新位置已回讀一致才刪）
    if a.move and stale:
        st, body = http(base, '/java/file/delete', data={'delete': json.dumps(stale)})
        if st != 200:
            print(f'[錯誤] 刪舊副本回 HTTP {st}: {body[:200]!r}')
            sys.exit(3)
        after = read_tree(base)
        left = [p for p in stale if p in after]
        if left:
            print('[錯誤] 這些舊副本還在，未 Build:', left)
            sys.exit(4)
        print(f'已刪 Hub 根目錄舊副本 {len(stale)} 支（備份在 {bdir}）')

    if a.no_build:
        return

    # 8. Build
    st, body = http(base, '/java/build/start', data={})
    print('Build 已觸發:', body[:120].decode('utf-8', 'replace').strip())
    t0 = time.time()
    while True:
        time.sleep(2)
        st, body = http(base, '/java/build/status')
        s = json.loads(body.decode('utf-8'))
        if s.get('completed') and not s.get('running') and s.get('startTimestamp', -1) > 0:
            break
        if time.time() - t0 > 300:
            print('[逾時] Build 超過 300 秒'); break
    st, log = http(base, '/java/build/log')
    log = log.decode('utf-8', 'replace')
    ok = s.get('successful')
    print('Build 結果:', 'SUCCESS' if ok else 'FAILED', f'（{time.time()-t0:.0f} 秒）')
    print('----- build log (tail) -----')
    print('\n'.join(log.strip().splitlines()[-25:]))
    if not ok:
        sys.exit(5)


if __name__ == '__main__':
    main()
