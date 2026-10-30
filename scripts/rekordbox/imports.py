"""Guarded imports of server-created download manifests; no public arbitrary-write API."""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
import xml.etree.ElementTree as ET
from dateutil.parser import parse as parse_date
from bridge import ROOT, STATE, COPIES, BridgeError, readonly, inspect, require_closed, snapshot, copy_path, atomic_write, file_digest, metadata_values, apply_track_metadata


def read_manifest(request, copy_id):
    supplied = Path(request.get('jobPath', '')).absolute()
    path = supplied.resolve(strict=True)
    if supplied.is_symlink() or path.name not in ('job.json', 'probe-job.json'):
        raise BridgeError('invalid_job', 'Invalid download manifest.')
    if copy_id:
        library = copy_path(copy_id)
        if path.parent != library.parent:
            raise BridgeError('invalid_job', 'The test manifest must stay inside its isolated library copy.')
    else:
        if path.name != 'job.json' or path.parent.parent.parent != (ROOT / '.data/downloads').resolve():
            raise BridgeError('invalid_job', 'Import requires a local download job.')
        if not re.fullmatch(r'[a-f0-9]{64}', path.parent.parent.name):
            raise BridgeError('invalid_job', 'Invalid download owner.')
        try: uuid.UUID(path.parent.name)
        except ValueError: raise BridgeError('invalid_job', 'Invalid download job ID.')
        library = None
    if path.stat().st_size > 2000000:
        raise BridgeError('invalid_job', 'Download manifest is too large.')
    job = json.loads(path.read_text())
    if job.get('version') != 2 or job.get('delivery') != 'folder' or not job.get('sourcePlaylist'):
        raise BridgeError('invalid_job', 'This job has no source playlist. Start a new download to import it.')
    if not isinstance(job.get('tracks'), list) or not 1 <= len(job['tracks']) <= 50:
        raise BridgeError('invalid_job', 'Invalid download track list.')
    mapping = job.get('rekordbox', {})
    if not isinstance(mapping, dict) or not mapping.get('libraryId') or not mapping.get('destination'):
        raise BridgeError('needs_destination', 'Choose a Rekordbox destination, then retry the import.')
    if library is None:
        try: library = Path(mapping.get('libraryPath', '')).resolve(strict=True)
        except FileNotFoundError: raise BridgeError('library_unavailable', 'Rekordbox library unavailable. Reconnect its original drive to resume.')
    if library.name != 'master.db' or library.is_symlink():
        raise BridgeError('invalid_library', 'Invalid Rekordbox database path.')
    return path, job, library


def verify_audio(job, track):
    folder = Path(job['outputFolder']).resolve(strict=True)
    info = folder.stat()
    identity = job['destinationIdentity']
    if str(info.st_dev) != identity['device'] or str(info.st_ino) != identity['inode']:
        raise BridgeError('folder_changed', 'The download folder changed. Reconnect its drive before importing.')
    raw = Path(track.get('path', ''))
    audio = raw.resolve(strict=True)
    if raw.is_symlink() or audio.parent != folder or audio.name != track.get('filename') or audio.suffix.lower() != '.mp3':
        raise BridgeError('invalid_audio', 'The saved MP3 is outside its recorded download folder.')
    video_id = track.get('videoId', '')
    if not isinstance(video_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise BridgeError('invalid_audio', 'Invalid recording identity.')
    receipt = json.loads((folder / '.crate-digger/recordings' / (video_id + '.json')).read_text())
    if receipt.get('filename') != audio.name or receipt.get('videoId') != video_id or receipt.get('sha256') != file_digest(audio):
        raise BridgeError('audio_changed', 'The saved MP3 changed after download. Review it before importing.')
    result = subprocess.run([job.get('ffprobe', '/opt/homebrew/bin/ffprobe'), '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(audio)], capture_output=True, text=True, check=True, timeout=30)
    media = json.loads(result.stdout)
    stream = next((s for s in media.get('streams', []) if s.get('codec_type') == 'audio' and s.get('codec_name') == 'mp3'), None)
    duration = float(media.get('format', {}).get('duration', 0))
    if not stream or not 0 < duration <= 1801:
        raise BridgeError('invalid_audio', 'The saved file has no valid MP3 audio.')
    return audio, media, stream, metadata_values(track, media['format'].get('tags', {}))


def sync_playlist_xml(library, pid):
    """Merge ONLY this playlist's committed metadata into the current XML."""
    path = library.parent / 'masterPlaylists6.xml'
    before = file_digest(path)
    tree = ET.parse(path)
    playlists = tree.getroot().find('PLAYLISTS')
    if playlists is None:
        raise BridgeError('auxiliary_invalid', 'Rekordbox playlist metadata is not valid XML.')
    with readonly(library) as conn:
        row = conn.execute('SELECT ParentID,Attribute,updated_at FROM djmdPlaylist WHERE ID=? AND coalesce(rb_local_deleted,0)=0', (pid,)).fetchone()
    if row is None or int(row[1]) != 0:
        raise BridgeError('needs_destination', 'The destination playlist is no longer available.')
    hex_id = f'{int(pid):X}'
    nodes = [node for node in playlists.iter('NODE') if node.get('Id', '').upper() == hex_id]
    if len(nodes) > 1:
        raise BridgeError('auxiliary_invalid', 'Duplicate destination entries exist in Rekordbox playlist metadata.')
    node = nodes[0] if nodes else ET.SubElement(playlists, 'NODE')
    node.attrib.update({'Id':hex_id, 'ParentId':'0' if row[0] == 'root' else f'{int(row[0]):X}', 'Attribute':'0', 'Timestamp':str(int(parse_date(str(row[2])).timestamp()*1000)), 'Lib_Type':node.get('Lib_Type', '0'), 'CheckType':node.get('CheckType', '0')})
    require_closed()
    if file_digest(path) != before:
        raise BridgeError('auxiliary_changed', 'Rekordbox playlist metadata changed during import. Retry after closing Rekordbox.')
    atomic_write(path, ET.tostring(tree.getroot(), encoding='utf-8', xml_declaration=True))


def promote_mapping(job, destination):
    """Promote a create intent without replacing a newer explicit user choice."""
    value = job['rekordbox'].get('mappingPath')
    if not value: return False
    path = Path(value)
    root = (ROOT / '.data/rekordbox-mappings').resolve()
    if path.parent.resolve() != root or path.is_symlink() or not re.fullmatch(r'[a-f0-9]{64}\.json', path.name):
        raise BridgeError('invalid_mapping', 'Invalid destination mapping path.')
    lock_path = Path(str(path) + '.lock')
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return False
    try:
        current = json.loads(path.read_text())
        if current.get('sourceId') != job['sourcePlaylist']['id']: return False
        prior = current.get('destination')
        expected = job['rekordbox']['destination']
        if not isinstance(prior, dict): return False
        if prior != expected and not (prior.get('mode') == 'existing' and prior.get('id') == destination['id']): return False
        current['destination'] = destination
        atomic_write(path, json.dumps(current, ensure_ascii=False, separators=(',', ':')).encode())
        return True
    finally:
        os.close(fd)


def prune_import_backups(library):
    """Keep five generated verified backups, plus those needed by pending jobs."""
    import shutil
    protected = set()
    journals = STATE / 'imports'
    for path in journals.glob('*.json'):
        try:
            item = json.loads(path.read_text())
            if item.get('libraryPath') == str(library) and item.get('state') != 'verified':
                protected.update(item.get('backupHistory', []))
                if item.get('backupId'): protected.add(item['backupId'])
        except (OSError, ValueError): continue
    backups = []
    for folder in COPIES.iterdir():
        if not folder.is_dir() or folder.is_symlink(): continue
        try:
            info = json.loads((folder / 'manifest.json').read_text())
            if info.get('purpose') == 'import-backup' and info.get('source') == str(library):
                backups.append(folder)
        except (OSError, ValueError): continue
    for folder in sorted(backups, key=lambda p:p.stat().st_mtime, reverse=True)[5:]:
        if folder.name not in protected: shutil.rmtree(folder)


def check_cancelled(manifest):
    if (manifest.parent / 'cancel.json').exists():
        raise BridgeError('cancelled', 'Import stopped before commit. Saved MP3s are safe.')


def reconcile_cancelled_import(library, manifest, job, journal, journal_path, copy_id):
    """Finish an already committed operation without beginning a new import."""
    pid = journal.get('playlistId')
    items = journal.get('tracks', [])
    if not pid or not items:
        check_cancelled(manifest)
    with readonly(library) as conn:
        for item in items:
            row = conn.execute('SELECT c.FolderPath FROM djmdContent c JOIN djmdSongPlaylist m ON m.ContentID=c.ID WHERE c.ID=? AND m.PlaylistID=? AND coalesce(c.rb_local_deleted,0)=0 AND coalesce(m.rb_local_deleted,0)=0', (item['contentId'], pid)).fetchone()
            if row is None or row[0] != item['path']:
                # The prepared transaction rolled back. There is no commit to finish.
                check_cancelled(manifest)
    sync_playlist_xml(library, pid)
    from bridge import library_playlists
    entry = next(p for p in library_playlists({'libraryPath': str(library)})['playlists'] if p['id'] == pid)
    destination = {'mode': 'existing', 'id': pid, 'name': entry['name'], 'path': entry['path']}
    promoted = False if copy_id else promote_mapping(job, destination)
    journal.update(state='verified', destination=destination, mappingPromoted=promoted)
    atomic_write(journal_path, json.dumps(journal, indent=2).encode())
    return {'verified': True, 'destination': destination, 'tracks': items, 'backupId': journal.get('backupId'), 'journalPath': str(journal_path), 'mappingPromoted': promoted}


def import_download_job(request, copy_id=None):
    manifest, job, library = read_manifest(request, copy_id)
    identity = inspect(library)
    if not identity['schemaSupported'] or identity.get('libraryId') != job['rekordbox']['libraryId']:
        raise BridgeError('library_changed', 'The destination library changed or is unsupported. Check Settings and retry.')
    require_closed()
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    journal_dir = (library.parent / 'import-journals') if copy_id else (STATE / 'imports')
    journal_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    journal_path = journal_dir / (hashlib.sha256(str(manifest).encode()).hexdigest() + '.json')
    with (STATE / 'writer.lock').open('a') as lock:
        try: fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise BridgeError('writer_busy', 'Another Rekordbox import is active. Waiting for it to finish.')
        require_closed()
        previous = json.loads(journal_path.read_text()) if journal_path.exists() else {}
        if previous.get('libraryId') != identity['libraryId'] or previous.get('libraryPath') != str(library): previous = {}
        if (manifest.parent / 'cancel.json').exists() and previous.get('state') in ('prepared', 'database-committed'):
            return reconcile_cancelled_import(library, manifest, job, previous, journal_path, copy_id)
        check_cancelled(manifest)
        verified, failures = [], []
        for track in job['tracks']:
            if track.get('state') != 'saved': continue
            try: verified.append((track, *verify_audio(job, track)))
            except Exception as e:
                failures.append({'videoId':track.get('videoId'), 'state':'failed', 'error':str(e) if isinstance(e, BridgeError) else 'Saved MP3 unavailable or invalid. Reconnect its drive and retry.'})
        if not verified:
            return {'destination':job['rekordbox']['destination'], 'tracks':failures, 'verified':False}
        check_cancelled(manifest)
        backup = snapshot(library, purpose='isolated-import-backup' if copy_id else 'import-backup')
        from pyrekordbox import MasterDatabase
        from pyrekordbox.masterdb import models
        from sqlalchemy import text
        db = MasterDatabase(path=library, db_dir=library.parent)
        if db.playlist_xml is None:
            db.close();db.engine.dispose()
            raise BridgeError('auxiliary_missing', 'Rekordbox playlist metadata is missing. Restore it before importing.')
        # DB commit and auxiliary XML are not one transaction. Journal our IDs
        # before commit; publish a fresh targeted XML merge after read-back.
        db.playlist_xml.save = lambda *args, **kwargs: None
        try:
            db.session.execute(text('PRAGMA synchronous = FULL'))
            db.session.execute(text('PRAGMA fullfsync = ON'))
            check_cancelled(manifest)
            require_closed()
            db.session.execute(text('BEGIN IMMEDIATE'))
            target = job['rekordbox']['destination']
            pid = target.get('id') if target.get('mode') == 'existing' else previous.get('playlistId')
            playlist = db.get_playlist(ID=pid) if pid else None
            if playlist is not None and (playlist.rb_local_deleted or playlist.Attribute != 0): playlist = None
            if target.get('mode') == 'existing' and playlist is None:
                raise BridgeError('needs_destination', 'The destination playlist was removed or is no longer ordinary.')
            if playlist is None:
                candidates = db.query(models.DjmdPlaylist).filter_by(Name=target['name'], Attribute=0, rb_local_deleted=0).all()
                if len(candidates) > 1: raise BridgeError('needs_destination', 'Several Rekordbox playlists now share this name. Choose a destination.')
                playlist = candidates[0] if candidates else db.create_playlist(target['name'])
            db.flush()
            pid = str(playlist.ID)
            imported = []
            for track, audio, media, stream, values in verified:
                existing = db.query(models.DjmdContent).filter_by(FolderPath=str(audio), rb_local_deleted=0).all()
                if len(existing) > 1: raise BridgeError('duplicate_content', 'Multiple collection entries point to a downloaded MP3. Resolve them in Rekordbox before retrying.')
                content = existing[0] if existing else None
                if content is None:
                    content = db.add_content(audio, Title=values.get('title') or track['title'], Length=int(float(media['format']['duration'])), SampleRate=int(stream['sample_rate']), BitRate=int(int(stream.get('bit_rate', media['format'].get('bit_rate',0)))/1000))
                    content.MasterDBID, content.DeviceID = identity['libraryId'], identity['deviceId']
                    content.ContentLink, content.ServiceID = 0x002c0600, 0
                    content.rb_file_id = str(audio.stat().st_ino)
                    apply_track_metadata(db, content, values)
                # Existing collection tracks keep cues, grids, ratings and tags.
                member = db.query(models.DjmdSongPlaylist).filter_by(PlaylistID=pid, ContentID=content.ID, rb_local_deleted=0).first()
                if member is None:
                    from sqlalchemy import func
                    last = db.query(func.max(models.DjmdSongPlaylist.TrackNo)).filter_by(PlaylistID=pid, rb_local_deleted=0).scalar() or 0
                    member = db.add_to_playlist(playlist, content)
                    member.TrackNo = int(last) + 1
                imported.append({'videoId':track['videoId'],'path':str(audio),'contentId':str(content.ID),'state':'imported'})
            db.flush()
            destination = {'mode':'existing','id':pid,'name':playlist.Name,'path':playlist.Name}
            journal = {'state':'prepared','libraryId':identity['libraryId'],'libraryPath':str(library),'manifest':str(manifest),'playlistId':pid,'tracks':imported,'backupId':backup['copyId'],'backupHistory':list(dict.fromkeys(previous.get('backupHistory',[])+([previous['backupId']] if previous.get('backupId') else [])+[backup['copyId']]))}
            atomic_write(journal_path, json.dumps(journal,indent=2).encode())
            require_closed()
            check_cancelled(manifest)
            db.commit()
            journal['state'] = 'database-committed'
            atomic_write(journal_path, json.dumps(journal,indent=2).encode())
        except Exception:
            db.rollback()
            raise
        finally:
            db.close();db.engine.dispose()
        sync_playlist_xml(library, pid)
        with readonly(library) as conn:
            for item in imported:
                row = conn.execute('SELECT c.FolderPath,count(m.ID) FROM djmdContent c JOIN djmdSongPlaylist m ON m.ContentID=c.ID WHERE c.ID=? AND m.PlaylistID=? AND coalesce(c.rb_local_deleted,0)=0 AND coalesce(m.rb_local_deleted,0)=0 GROUP BY c.ID',(item['contentId'],pid)).fetchone()
                if row is None or row[0] != item['path'] or row[1] < 1:
                    raise BridgeError('verification_failed','Import read-back failed. The MP3 is safe; retry the library import.')
        # Use the actual hierarchy for the promoted mapping.
        from bridge import library_playlists
        current = library_playlists({'libraryPath':str(library)})
        entry = next(p for p in current['playlists'] if p['id'] == pid)
        destination['path'] = entry['path']
        promoted = False if copy_id else promote_mapping(job, destination)
        journal.update(state='verified',destination=destination,mappingPromoted=promoted)
        atomic_write(journal_path, json.dumps(journal,indent=2).encode())
        if not copy_id:
            try: prune_import_backups(library)
            except OSError: pass
        return {'verified':not failures,'destination':destination,'tracks':imported+failures,'backupId':backup['copyId'],'journalPath':str(journal_path),'mappingPromoted':promoted}
