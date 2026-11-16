import importlib.machinery
import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
loader = importlib.machinery.SourceFileLoader("cookie_sync", os.path.join(HERE, "rakazo-cookie-sync"))
spec = importlib.util.spec_from_loader("cookie_sync", loader)
sync = importlib.util.module_from_spec(spec)
loader.exec_module(sync)

NOW = 1_800_000_000.0


def cookie(name, value, domain=".reddit.com", **extra):
    return {"name": name, "value": value, "domain": domain, "path": "/", "expires": NOW + 3600,
            "secure": True, "httpOnly": True, "sameSite": "Lax", "session": False, **extra}


class CookieSyncTest(unittest.TestCase):
    def test_sign_in_on_one_browser_reaches_the_others(self):
        store = {}
        seen_a, _ = sync.reconcile(store, None, [], NOW)
        seen_b, _ = sync.reconcile(store, None, [], NOW)
        # Bot A signs in.
        seen_a, changed = sync.reconcile(store, seen_a, [cookie("session", "abc")], NOW)
        self.assertTrue(changed)
        to_set, to_remove = sync.plan(store, [])
        self.assertEqual([c["value"] for c in to_set], ["abc"])
        self.assertEqual(to_remove, [])
        self.assertNotIn("session", to_set[0])

    def test_sign_out_removes_the_cookie_everywhere(self):
        store = {}
        seen_a, _ = sync.reconcile(store, None, [cookie("session", "abc")], NOW)
        seen_a, _ = sync.reconcile(store, seen_a, [], NOW + 5)
        self.assertEqual(store["cookies"], {})
        to_set, to_remove = sync.plan(store, [cookie("session", "abc")])
        self.assertEqual(to_set, [])
        self.assertEqual(len(to_remove), 1)
        self.assertEqual(to_remove[0]["expires"], 1)

    def test_a_new_browser_cannot_undo_a_newer_sign_in(self):
        store = {}
        seen_a, _ = sync.reconcile(store, None, [], NOW)
        sync.reconcile(store, seen_a, [cookie("session", "new")], NOW)
        # Bot B starts with an old value in its own profile.
        sync.reconcile(store, None, [cookie("session", "old")], NOW + 1)
        self.assertEqual(next(iter(store["cookies"].values()))["value"], "new")
        to_set, _ = sync.plan(store, [cookie("session", "old")])
        self.assertEqual([c["value"] for c in to_set], ["new"])

    def test_a_signed_out_cookie_is_not_revived_by_a_stale_browser(self):
        store = {}
        seen_a, _ = sync.reconcile(store, None, [cookie("session", "abc")], NOW)
        sync.reconcile(store, seen_a, [], NOW + 5)
        sync.reconcile(store, None, [cookie("session", "abc")], NOW + 10)
        self.assertEqual(store["cookies"], {})

    def test_session_cookies_are_shared_without_an_expiry(self):
        store = {}
        seen_a, _ = sync.reconcile(store, None, [], NOW)
        sync.reconcile(store, seen_a, [cookie("sid", "s", expires=-1, session=True)], NOW)
        to_set, _ = sync.plan(store, [])
        self.assertNotIn("expires", to_set[0])

    def test_expired_cookies_are_dropped(self):
        store = {}
        seen_a, _ = sync.reconcile(store, None, [], NOW)
        sync.reconcile(store, seen_a, [cookie("old", "x", expires=NOW - 10)], NOW)
        self.assertEqual(store["cookies"], {})


if __name__ == "__main__":
    unittest.main()
