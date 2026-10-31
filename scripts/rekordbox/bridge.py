"""Local Rekordbox compatibility bridge. JSON stdin/stdout; no network service.

Exposes status, isolated compatibility checks and guarded download-job imports.
Installed-library writes require stopped Rekordbox processes, a verified backup,
a shared writer lock and a durable database/auxiliary-file journal.
"""
from __future__ import annotations
import contextlib
import hashlib
import json
import logging
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.data' / 'rekordbox'
COPIES = STATE / 'copies'
REQUIRED = {
    'djmdProperty': {'DBID', 'DeviceID', 'DBVersion'},
    'djmdContent': {'ID', 'UUID', 'Title', 'FolderPath', 'ArtistID', 'AlbumID', 'ContentLink', 'ServiceID', 'FileSize', 'FileType', 'Length', 'SampleRate', 'BitRate', 'DeviceID', 'MasterDBID', 'rb_file_id', 'rb_local_usn', 'rb_local_deleted', 'Analysed'},
    'djmdPlaylist': {'ID', 'Name', 'Attribute', 'ParentID', 'rb_local_deleted'},
    'djmdSongPlaylist': {'ID', 'ContentID', 'PlaylistID', 'TrackNo', 'rb_local_deleted'},
    'djmdArtist': {'ID', 'Name'},
    'djmdAlbum': {'ID', 'Name', 'AlbumArtistID'},
    'djmdDevice': {'ID', 'MasterDBID'},
    'djmdMenuItems': {'Name', 'rb_local_usn'},
    'agentRegistry': {'registry_id', 'int_1'},
}

class BridgeError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def installed_library(home=None):
    home = home or Path.home()
    settings = home / 'Library/Application Support/Pioneer/rekordbox6/rekordbox3.settings'
    folder = None
    source = 'default'
    if settings.exists():
        try:
            for node in ET.parse(settings).iter('VALUE'):
                if node.get('name') == 'masterDbDirectory':
                    value = node.get('val', '')
                    if value and Path(value).is_absolute():
                        folder, source = Path(value), 'rekordbox-settings'
        except (ET.ParseError, OSError):
            raise BridgeError('settings_unreadable', 'Rekordbox library settings could not be read.')
    if folder is None:
        options = home / 'Library/Application Support/Pioneer/rekordboxAgent/storage/options.json'
        if options.exists():
            try:
                value = json.loads(options.read_text()).get('db-path', '')
                if value and Path(value).is_absolute():
                    folder, source = Path(value).parent, 'agent-options'
            except (ValueError, OSError):
                raise BridgeError('settings_unreadable', 'Rekordbox agent options could not be read.')
    folder = folder or home / 'Library/Pioneer/rekordbox'
    db = folder / 'master.db'
    if not db.is_file():
        raise BridgeError('library_missing', 'The configured Rekordbox library is unavailable. Connect its drive.')
    return db.resolve(), source


def running_processes():
    # Failure to inspect processes is a blocker, never evidence of absence.
    result = subprocess.run(['/bin/ps', '-axo', 'comm='], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise BridgeError('process_check_failed', 'Cannot inspect Rekordbox processes in this environment.')
    names = {Path(line.strip()).name.lower() for line in result.stdout.splitlines()}
    return [name for name in ('rekordbox', 'rekordboxagent') if name in names]


def require_closed():
    names = running_processes()
    if names:
        raise BridgeError('rekordbox_running', 'Close ' + ' and '.join(names) + ' before updating the library.')


def dependencies():
    # No library configuration discovery or logging of connection credentials.
    logging.disable(logging.CRITICAL)
    from pyrekordbox.masterdb.database import BLOB
    from pyrekordbox.utils import deobfuscate
    from sqlcipher3 import dbapi2
    return dbapi2, deobfuscate(BLOB)


@contextlib.contextmanager
def readonly(path):
    sqlite, key = dependencies()
    conn = sqlite.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        conn.execute("PRAGMA key = '" + key.replace("'", "''") + "'")
        conn.execute('PRAGMA query_only = ON')
        conn.execute('SELECT count(*) FROM sqlite_master').fetchone()
        yield conn
    finally:
        conn.close()


def inspect(path):
    with readonly(path) as conn:
        missing = []
        for table, expected in REQUIRED.items():
            actual = {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
            missing.extend(f'{table}.{c}' for c in sorted(expected - actual))
        if missing:
            return {'schemaSupported': False, 'missing': missing}
        dbid, device, version = conn.execute('SELECT DBID, DeviceID, DBVersion FROM djmdProperty LIMIT 1').fetchone()
        counts = {key: conn.execute(f'SELECT count(*) FROM {table} WHERE coalesce(rb_local_deleted,0)=0').fetchone()[0]
                  for key, table in [('tracks', 'djmdContent'), ('playlists', 'djmdPlaylist')]}
        return {'schemaSupported': True, 'missing': [], 'libraryId': str(dbid), 'deviceId': str(device), 'schemaVersion': str(version), **counts}


def health(data=None):
    active, source = installed_library()
    override = (data or {}).get('libraryPath')
    path = Path(override).expanduser().resolve(strict=True) if override else active
    if path.name != 'master.db' or not path.is_file():
        raise BridgeError('invalid_library', 'Choose an existing master.db.')
    result = inspect(path)
    try:
        processes, process_error = running_processes(), None
    except BridgeError as e:
        processes, process_error = None, e.code
    versions = []
    for info in Path('/Applications').glob('rekordbox*/rekordbox.app/Contents/Info.plist'):
        with info.open('rb') as f:
            versions.append(plistlib.load(f).get('CFBundleShortVersionString'))
    return {**result, 'libraryPath': str(path), 'discoverySource': 'override' if override else source, 'versions': versions,
            'usingOverride': bool(override), 'overrideMatchesActiveLibrary': path == active,
            'blockingProcesses': processes, 'processCheckError': process_error,
            'installedLibraryWritesEnabled': bool(result['schemaSupported']), 'stage': 'connected'}


def library_playlists(data):
    active, _ = installed_library()
    path = Path(data['libraryPath']).expanduser().resolve(strict=True) if data.get('libraryPath') else active
    if path.name != 'master.db' or not path.is_file():
        raise BridgeError('invalid_library', 'Choose an existing master.db.')
    with readonly(path) as conn:
        library_id = str(conn.execute('SELECT DBID FROM djmdProperty LIMIT 1').fetchone()[0])
        rows = conn.execute('SELECT ID,Name,ParentID,Attribute FROM djmdPlaylist WHERE coalesce(rb_local_deleted,0)=0').fetchall()
    entries = {str(r[0]): {'id':str(r[0]),'name':r[1] or '', 'parentId':str(r[2]), 'attribute':int(r[3])} for r in rows}
    for entry in entries.values():
        names = [entry['name']]
        parent, seen = entry['parentId'], {entry['id']}
        while parent in entries and parent not in seen:
            seen.add(parent)
            names.insert(0,entries[parent]['name'])
            parent = entries[parent]['parentId']
        entry['path'] = ' / '.join(names)
    return {'libraryId':library_id,'libraryPath':str(path),'playlists':sorted(entries.values(),key=lambda p:(p['path'].casefold(),p['id']))}


def file_digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def match_content(data):
    import re
    import unicodedata
    norm=lambda v: re.sub(r'[^\w]+','',unicodedata.normalize('NFKC',str(v or '')).casefold())
    path=Path(data['libraryPath']).resolve(strict=True) if data.get('libraryPath') else installed_library()[0]
    with readonly(path) as conn:
        rows=conn.execute('SELECT c.ID,c.Title,a.Name,c.Length FROM djmdContent c LEFT JOIN djmdArtist a ON a.ID=c.ArtistID WHERE coalesce(c.rb_local_deleted,0)=0').fetchall()
    matches=[str(r[0]) for r in rows if norm(r[1])==norm(data.get('title')) and norm(r[2])==norm(data.get('artist')) and abs(int(r[3] or 0)*1000-int(data.get('durationMs',0)))<=5000]
    if not matches: raise BridgeError('local_track_missing','This song is not in your Rekordbox library. Download it first in Downloads.')
    if len(matches)!=1: raise BridgeError('local_track_ambiguous','Several local recordings match this song. Choose it from a Rekordbox source to save the exact recording.')
    return content_file({**data,'contentId':matches[0]})


def local_audio_path(conn, cid, primary):
    """Resolve local copies recorded by Rekordbox without changing its records."""
    from urllib.parse import urlparse, unquote
    columns={r[1] for r in conn.execute('PRAGMA table_info(djmdContent)')}
    names=[n for n in ('rb_LocalFolderPath','OrgFolderPath','FileNameL') if n in columns]
    row=conn.execute('SELECT '+','.join(names)+' FROM djmdContent WHERE ID=?',(cid,)).fetchone() if names else []
    values=dict(zip(names,row));filename=values.get('FileNameL')
    for value in (primary,values.get('rb_LocalFolderPath'),values.get('OrgFolderPath')):
        if not value: continue
        if value.startswith('file:'): value=unquote(urlparse(value).path)
        path=Path(value).expanduser()
        if not path.is_absolute(): continue
        if path.is_dir() and filename: path=path/filename
        if path.is_file(): return str(path.resolve())
    return None


def content_file(data):
    path = Path(data['libraryPath']).resolve(strict=True) if data.get('libraryPath') else installed_library()[0]
    cid = data.get('contentId', '')
    if not isinstance(cid,str) or not cid.isdigit(): raise BridgeError('invalid_track','Choose a local library track.')
    with readonly(path) as conn:
        row=conn.execute('SELECT c.ID,c.FolderPath,c.Title,a.Name,b.Name,c.Length FROM djmdContent c LEFT JOIN djmdArtist a ON a.ID=c.ArtistID LEFT JOIN djmdAlbum b ON b.ID=c.AlbumID WHERE c.ID=? AND coalesce(c.rb_local_deleted,0)=0',(cid,)).fetchone()
        audio_path=local_audio_path(conn,cid,row[1]) if row else None
    if not row: raise BridgeError('track_missing','This track is no longer in Rekordbox.')
    return {'localLibraryId':inspect(path)['libraryId'],'id':str(row[0]),'path':row[1],'audioPath':audio_path,'title':row[2] or 'Untitled','artist':row[3] or 'Unknown artist','album':row[4] or '', 'durationMs':int(row[5] or 0)*1000}


def source_tracks(data):
    path = Path(data['libraryPath']).resolve(strict=True) if data.get('libraryPath') else installed_library()[0]
    pid = data.get('playlistId', '')
    if not isinstance(pid, str) or not pid.isdigit():
        raise BridgeError('invalid_playlist', 'Choose a Rekordbox playlist.')
    with readonly(path) as conn:
        rows = conn.execute("SELECT c.ID,c.Title,a.Name,b.Name,c.Length FROM djmdSongPlaylist m JOIN djmdContent c ON c.ID=m.ContentID LEFT JOIN djmdArtist a ON a.ID=c.ArtistID LEFT JOIN djmdAlbum b ON b.ID=c.AlbumID WHERE m.PlaylistID=? AND coalesce(m.rb_local_deleted,0)=0 AND coalesce(c.rb_local_deleted,0)=0 ORDER BY m.TrackNo LIMIT 500", (pid,)).fetchall()
    library_id=inspect(path)['libraryId']
    return {'items': [{'localLibraryId':library_id,'id':'rekordbox:'+str(r[0]),'title':r[1] or 'Untitled','artist':r[2] or 'Unknown artist','album':r[3] or '', 'durationMs':int(r[4] or 0)*1000,'genre':'Rekordbox','artworkUrl':None,'sourceUrl':'/api/rekordbox/audio/'+str(r[0])+'?library='+library_id,'explicit':False} for r in rows]}


def snapshot(path=None, purpose=None):
    require_closed()
    if path is None: path, source = installed_library()
    else: path, source = Path(path).resolve(strict=True), 'explicit-library'
    info = inspect(path)
    if not info['schemaSupported']:
        raise BridgeError('unsupported_schema', 'Required Rekordbox schema fields are missing.')
    copy_id = str(uuid.uuid4())
    folder = COPIES / copy_id
    folder.mkdir(parents=True, mode=0o700)
    target = folder / 'master.db'
    try:
        # Read-only source snapshot includes committed WAL pages; destination is encrypted.
        with readonly(path) as conn:
            # VACUUM INTO is forbidden by query_only despite writing only the destination.
            # The source handle remains OS-level read-only throughout.
            conn.execute('PRAGMA query_only = OFF')
            conn.execute('VACUUM main INTO ?', (str(target),))
        target.chmod(0o600)
        aux = path.parent / 'masterPlaylists6.xml'
        if not aux.is_file():
            raise BridgeError('missing_auxiliary', 'masterPlaylists6.xml is required for the compatibility copy.')
        shutil.copy2(aux, folder / aux.name)
        require_closed()
        check = inspect(target)
        with readonly(target) as conn:
            if conn.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise BridgeError('snapshot_invalid', 'The snapshot integrity check failed.')
        if check != info:
            raise BridgeError('snapshot_changed', 'Library changed during the snapshot. Retry with Rekordbox closed.')
        manifest = {'id': copy_id, 'source': str(path), 'discoverySource': source, 'libraryId': info['libraryId'],
                    'sourceSha256': file_digest(path),
                    'kind': 'isolated-compatibility-copy', 'purpose': purpose}
        (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        return {'copyId': copy_id, 'verified': True, **check}
    except Exception:
        shutil.rmtree(folder)
        raise


def copy_path(copy_id):
    try:
        if str(uuid.UUID(copy_id)) != copy_id:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise BridgeError('invalid_copy', 'Invalid isolated copy ID.')
    folder = COPIES / copy_id
    manifest = json.loads((folder / 'manifest.json').read_text())
    path = folder / 'master.db'
    if folder.is_symlink() or path.is_symlink() or (folder / 'masterPlaylists6.xml').is_symlink():
        raise BridgeError('invalid_copy', 'Compatibility files cannot be symlinks.')
    if manifest.get('kind') != 'isolated-compatibility-copy' or path.resolve().parent != folder.resolve() or folder.resolve().parent != COPIES.resolve():
        raise BridgeError('invalid_copy', 'Writes require an isolated compatibility copy.')
    installed, _ = installed_library()
    if path.samefile(installed):
        raise BridgeError('installed_write_refused', 'This command cannot modify the installed library.')
    return path


def metadata_values(data, tags):
    tags = {str(k).lower(): v for k, v in tags.items()}
    result = {}
    for name in ('title', 'artist', 'album'):
        value = data.get(name, tags.get(name, ''))
        if not isinstance(value, str) or len(value) > 299 or '\x00' in value:
            raise BridgeError('invalid_metadata', 'Track metadata must be text shorter than 300 characters.')
        if value.strip(): result[name] = value.strip()
    return result


def apply_track_metadata(db, content, values):
    if values.get('title'): content.Title = values['title']
    artist = None
    if values.get('artist'):
        artist = db.get_artist(Name=values['artist']).one_or_none() or db.add_artist(values['artist'])
        content.ArtistID = artist.ID
    if values.get('album'):
        album = db.get_album(Name=values['album']).first() or db.add_album(values['album'], artist=artist)
        content.AlbumID = album.ID


def import_copy(data):
    return import_at(copy_path(data.get('copyId')), data)


def import_at(path, data):
    require_closed()
    audio = Path(data.get('audioPath', '')).expanduser().resolve(strict=True)
    if audio.suffix.lower() != '.mp3' or not audio.is_file():
        raise BridgeError('invalid_audio', 'Choose an existing MP3 for compatibility verification.')
    playlist_name = str(data.get('playlistName', 'Crate Digger compatibility check')).strip()
    if not playlist_name or len(playlist_name) > 200:
        raise BridgeError('invalid_playlist', 'Playlist name must contain 1–200 characters.')
    ffprobe = os.environ.get('FFPROBE_PATH', '/opt/homebrew/bin/ffprobe')
    raw = subprocess.run([ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(audio)], check=True, capture_output=True, text=True, timeout=30)
    media = json.loads(raw.stdout)
    stream = next((s for s in media['streams'] if s.get('codec_name') == 'mp3'), None)
    seconds = float(media['format']['duration'])
    if not stream or seconds <= 0:
        raise BridgeError('invalid_audio', 'The file does not contain playable MP3 audio.')
    tags = media['format'].get('tags', {})
    values = metadata_values(data, tags)
    from pyrekordbox import MasterDatabase
    from pyrekordbox.masterdb import models
    from sqlalchemy import text
    db = MasterDatabase(path=path, db_dir=path.parent)
    if db.playlist_xml is not None:
        def save_auxiliary(*args, **kwargs):
            atomic_write(path.parent / 'masterPlaylists6.xml', db.playlist_xml.to_string().encode())
        db.playlist_xml.save = save_auxiliary
    try:
        db.session.execute(text('PRAGMA synchronous = FULL'))
        db.session.execute(text('PRAGMA fullfsync = ON'))
        db.session.execute(text('BEGIN IMMEDIATE'))
        content = db.query(models.DjmdContent).filter_by(FolderPath=str(audio), rb_local_deleted=0).one_or_none()
        created = content is None
        if content is None:
            content = db.add_content(audio, Title=values.get('title') or audio.stem,
                                     Length=int(seconds), SampleRate=int(stream['sample_rate']),
                                     BitRate=int(int(media['format'].get('bit_rate', 0)) / 1000))
            # pyrekordbox chooses the first djmdDevice row; use the library's actual owner.
            with readonly(path) as conn:
                dbid, deviceid = conn.execute('SELECT DBID, DeviceID FROM djmdProperty LIMIT 1').fetchone()
            content.MasterDBID, content.DeviceID = dbid, deviceid
            # add_content() incorrectly uses djmdMenuItems.rb_local_usn here.
            # Use the local-file registration verified during the playback repair.
            # Never inherit streaming/restriction bits from that counter.
            content.ContentLink = 0x002c0600
            content.ServiceID = 0
            content.rb_file_id = str(audio.stat().st_ino)
        apply_track_metadata(db, content, values)
        playlists = db.query(models.DjmdPlaylist).filter_by(Name=playlist_name, Attribute=0, rb_local_deleted=0).all()
        if len(playlists) > 1:
            raise BridgeError('ambiguous_playlist', 'Multiple ordinary playlists have this name.')
        playlist = playlists[0] if playlists else db.create_playlist(playlist_name)
        db.flush()
        membership = db.query(models.DjmdSongPlaylist).filter_by(PlaylistID=playlist.ID, ContentID=content.ID, rb_local_deleted=0).first()
        if membership is None:
            db.add_to_playlist(playlist, content)
        cid, pid = str(content.ID), str(playlist.ID)
        require_closed()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        db.engine.dispose()
    with readonly(path) as conn:
        count = conn.execute('SELECT count(*) FROM djmdSongPlaylist WHERE ContentID=? AND PlaylistID=? AND rb_local_deleted=0', (cid, pid)).fetchone()[0]
        row = conn.execute('SELECT FolderPath, rb_local_usn, Analysed FROM djmdContent WHERE ID=?', (cid,)).fetchone()
    xml = ET.parse(path.parent / 'masterPlaylists6.xml')
    auxiliary = any(n.get('Id', '').upper() == f'{int(pid):X}' for n in xml.iter('NODE'))
    if count != 1 or row[0] != str(audio) or not auxiliary:
        raise BridgeError('verification_failed', 'The isolated import did not pass read-back verification.')
    return {'copyId': data['copyId'], 'contentId': cid, 'playlistId': pid, 'created': created,
            'membershipCount': count, 'localUpdateCounter': row[1], 'analysisState': row[2],
            'auxiliaryVerified': auxiliary, 'verified': True, 'installedLibraryModified': path == installed_library()[0]}


def atomic_write(path, content):
    temp = path.with_name(path.name + '.' + str(uuid.uuid4()) + '.tmp')
    try:
        with temp.open('xb') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        temp.replace(path)
        fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        temp.unlink(missing_ok=True)


def acceptance_import(data):
    """One controlled installed-library proof, requiring a verified isolated run.

    Not exposed by HTTP. Full download import/recovery is a later phase.
    """
    import fcntl
    proof_path = copy_path(data.get('copyId'))
    proof = json.loads((proof_path.parent / 'verification.json').read_text())
    if not proof.get('sourceDatabaseUnchanged') or not proof['repeatImport']['verified'] or not proof['secondPlaylist']['verified']:
        raise BridgeError('proof_required', 'An isolated compatibility proof is required.')
    installed, _ = installed_library()
    identity = inspect(installed)
    manifest = json.loads((proof_path.parent / 'manifest.json').read_text())
    if identity.get('libraryId') != manifest['libraryId']:
        raise BridgeError('library_changed', 'The installed library differs from the compatibility proof.')
    with (STATE / 'writer.lock').open('a') as lock:
        try: fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise BridgeError('writer_busy', 'Another Rekordbox writer is active.')
        require_closed()
        backup = snapshot()
        with readonly(proof_path) as conn:
            source = Path(conn.execute('SELECT FolderPath FROM djmdContent WHERE ID=?', (proof['repeatImport']['contentId'],)).fetchone()[0])
        destination = Path.home() / 'Music' / 'Crate Digger'
        destination.mkdir(parents=True, exist_ok=True)
        digest = file_digest(source)
        audio = destination / (source.stem[:120] + ' [' + digest[:10] + '].mp3')
        if audio.exists():
            if file_digest(audio) != digest: raise BridgeError('file_conflict', 'The acceptance MP3 already exists with different contents.')
        else:
            with source.open('rb') as src, audio.open('xb') as dst:
                shutil.copyfileobj(src, dst)
                dst.flush()
                os.fsync(dst.fileno())
        journal = {'state': 'importing', 'backupId': backup['copyId'], 'libraryId': manifest['libraryId'], 'audioPath': str(audio)}
        journal_path = STATE / 'acceptance-import.json'
        atomic_write(journal_path, json.dumps(journal, indent=2).encode())
        result = import_at(installed, {**data, 'audioPath': str(audio), 'playlistName': 'Crate Digger compatibility check'})
        journal.update(state='database-verified', result=result)
        atomic_write(journal_path, json.dumps(journal, indent=2).encode())
        return {**result, 'backupId': backup['copyId'], 'audioPath': str(audio), 'nativePlaybackVerified': False}


def repair_acceptance():
    """Repair only the single record owned by the controlled acceptance receipt."""
    import fcntl
    receipt_path = STATE / 'acceptance-import.json'
    receipt = json.loads(receipt_path.read_text())
    path, _ = installed_library()
    if inspect(path).get('libraryId') != receipt['libraryId']:
        raise BridgeError('library_changed', 'The acceptance library no longer matches.')
    audio = Path(receipt['audioPath']).resolve(strict=True)
    cid = receipt['result']['contentId']
    with (STATE / 'writer.lock').open('a') as lock:
        try: fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise BridgeError('writer_busy', 'Another Rekordbox writer is active.')
        require_closed()
        backup = snapshot()
        from pyrekordbox import MasterDatabase
        db = MasterDatabase(path=path, db_dir=path.parent)
        try:
            content = db.get_content(ID=cid)
            if content is None or Path(content.FolderPath).resolve() != audio:
                raise BridgeError('record_changed', 'The acceptance record no longer points to its MP3.')
            before = {'ContentLink': content.ContentLink, 'rb_file_id': content.rb_file_id}
            # Local-file registration observed by rbxport after Rekordbox reads
            # a local file. Reset bogus streaming/restriction bits on OUR record.
            content.ContentLink = 0x002c0600
            content.ServiceID = 0
            content.rb_file_id = str(audio.stat().st_ino)
            require_closed()
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
            db.engine.dispose()
        with readonly(path) as conn:
            after = conn.execute('SELECT ContentLink,rb_file_id FROM djmdContent WHERE ID=?',(cid,)).fetchone()
        if after != (0x002c0600, str(audio.stat().st_ino)):
            raise BridgeError('verification_failed', 'Repair read-back failed.')
        receipt['repair'] = {'backupId': backup['copyId'], 'before': before, 'after': {'ContentLink': after[0], 'rb_file_id': after[1]}}
        receipt['state'] = 'registration-repaired-playback-pending'
        atomic_write(receipt_path, json.dumps(receipt, indent=2).encode())
        return {'contentId': cid, 'repaired': True, 'backupId': backup['copyId'], 'playbackVerified': False}


def update_acceptance_metadata(data):
    import fcntl
    receipt_path = STATE / 'acceptance-import.json'
    receipt = json.loads(receipt_path.read_text())
    path, _ = installed_library()
    if inspect(path).get('libraryId') != receipt['libraryId']:
        raise BridgeError('library_changed', 'The acceptance library no longer matches.')
    values = metadata_values(data, {})
    if not values.get('title') or not values.get('artist'):
        raise BridgeError('invalid_metadata', 'Title and artist are required.')
    audio = Path(receipt['audioPath']).resolve(strict=True)
    cid = receipt['result']['contentId']
    with (STATE / 'writer.lock').open('a') as lock:
        try: fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise BridgeError('writer_busy', 'Another Rekordbox writer is active.')
        require_closed()
        with readonly(path) as conn:
            row = conn.execute('SELECT FolderPath FROM djmdContent WHERE ID=?',(cid,)).fetchone()
            if row is None or Path(row[0]).resolve() != audio:
                raise BridgeError('record_changed', 'The acceptance track no longer matches its file.')
        backup = snapshot()
        shutil.copy2(audio, COPIES / backup['copyId'] / 'acceptance-audio.mp3')
        receipt['metadataUpdate'] = {'state': 'tagging', 'values': values, 'backupId': backup['copyId']}
        atomic_write(receipt_path, json.dumps(receipt, indent=2).encode())
        tagged = audio.with_name('.' + str(uuid.uuid4()) + '.mp3')
        args = [os.environ.get('FFMPEG_PATH','/opt/homebrew/bin/ffmpeg'), '-nostdin', '-v','error','-i',str(audio),'-map','0','-c','copy','-map_metadata','0']
        for key, value in values.items(): args.extend(['-metadata',key+'='+value])
        args.extend(['-id3v2_version','3',str(tagged)])
        try:
            subprocess.run(args,check=True,capture_output=True,timeout=30)
            with tagged.open('rb') as f: os.fsync(f.fileno())
            require_closed()
            tagged.replace(audio)
        finally: tagged.unlink(missing_ok=True)
        from pyrekordbox import MasterDatabase
        db = MasterDatabase(path=path, db_dir=path.parent)
        try:
            content = db.get_content(ID=cid)
            apply_track_metadata(db, content, values)
            content.FileSize = audio.stat().st_size
            content.rb_file_id = str(audio.stat().st_ino)
            require_closed()
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
            db.engine.dispose()
        with readonly(path) as conn:
            row = conn.execute('SELECT c.Title,a.Name,b.Name FROM djmdContent c LEFT JOIN djmdArtist a ON c.ArtistID=a.ID LEFT JOIN djmdAlbum b ON c.AlbumID=b.ID WHERE c.ID=?',(cid,)).fetchone()
        if row[0] != values['title'] or row[1] != values['artist'] or (values.get('album') and row[2] != values['album']):
            raise BridgeError('verification_failed','Track metadata read-back failed.')
        receipt['metadataUpdate']['state'] = 'verified'
        receipt['nativePlaybackVerified'] = True
        receipt['playbackVerificationSource'] = 'user-confirmed-after-registration-repair'
        atomic_write(receipt_path, json.dumps(receipt, indent=2).encode())
        return {'title':row[0],'artist':row[1],'album':row[2],'verified':True}


def main():
    try:
        request = {'action': 'health', 'libraryPath': sys.argv[2] if len(sys.argv)>2 else None} if sys.argv[1:2] == ['health'] else json.loads(sys.stdin.read(16000))
        action = request.get('action')
        if action == 'health': result = health(request)
        elif action == 'playlists': result = library_playlists(request)
        elif action == 'source-tracks': result = source_tracks(request)
        elif action == 'content-file': result = content_file(request)
        elif action == 'match-content': result = match_content(request)
        elif action == 'import-job':
            from imports import import_download_job
            result = import_download_job(request)
        elif action == 'import-job-copy':
            from imports import import_download_job
            result = import_download_job(request, copy_id=request.get('copyId'))
        elif action == 'snapshot': result = snapshot()
        elif action == 'import-copy': result = import_copy(request)
        elif action == 'acceptance-import': result = acceptance_import(request)
        elif action == 'repair-acceptance': result = repair_acceptance()
        elif action == 'update-acceptance-metadata': result = update_acceptance_metadata(request)
        else: raise BridgeError('invalid_action', 'Unknown Rekordbox action.')
        print(json.dumps({'ok': True, 'result': result}))
    except BridgeError as e:
        print(json.dumps({'ok': False, 'code': e.code, 'error': str(e)}))
        sys.exit(1)
    except Exception as e:
        # Driver exceptions can contain database keys or private SQL parameters.
        print(json.dumps({'ok': False, 'code': 'bridge_failed', 'error': 'Rekordbox compatibility operation failed.', 'errorType': type(e).__name__}))
        sys.exit(1)

if __name__ == '__main__':
    sys.modules['bridge'] = sys.modules[__name__]
    main()
