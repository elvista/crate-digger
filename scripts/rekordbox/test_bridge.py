"""Small filesystem-only guard checks; never opens an installed database."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import bridge

class BridgeGuards(unittest.TestCase):
    def test_missing_configured_drive_does_not_fall_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp)
            default=home/'Library/Pioneer/rekordbox'
            default.mkdir(parents=True)
            (default/'master.db').touch()
            settings=home/'Library/Application Support/Pioneer/rekordbox6/rekordbox3.settings'
            settings.parent.mkdir(parents=True)
            settings.write_text('<PROPERTIES><VALUE name="masterDbDirectory" val="/Volumes/MissingCrateTest/library"/></PROPERTIES>')
            with self.assertRaises(bridge.BridgeError) as caught:
                bridge.installed_library(home)
            self.assertEqual(caught.exception.code,'library_missing')

    def test_copy_ids_and_process_checks_fail_closed(self):
        for value in ('../master.db','',None,'health'):
            with self.assertRaises(bridge.BridgeError):bridge.copy_path(value)
        with patch.object(bridge,'running_processes',return_value=['rekordboxagent']):
            with self.assertRaises(bridge.BridgeError) as caught:bridge.require_closed()
            self.assertEqual(caught.exception.code,'rekordbox_running')
        with patch.object(bridge.subprocess,'run') as run:
            run.return_value.returncode=1
            with self.assertRaises(bridge.BridgeError):bridge.running_processes()

if __name__=='__main__':unittest.main()
