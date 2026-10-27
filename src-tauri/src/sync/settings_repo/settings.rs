//! Which settings leave the machine, and how a pulled change lands.
//!
//! The renderer keeps its settings as one object of groups (`appearance`,
//! `behavior`, ...). The repo holds one file per synced group. A pull lands
//! three-way, leaf by leaf, so a setting changed here while a sync ran, or
//! since the conflict a resolution answers, is never overwritten.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::local::Object;

/// The settings groups the repo carries, one file each. `privacy` is not
/// among them: error reporting consent is given on each machine.
pub(super) const SYNCED_GROUPS: [&str; 9] = [
    "appearance",
    "layout",
    "behavior",
    "keybindings",
    "editor",
    "markdown",
    "print",
    "ai",
    "corePlugins",
];

/// Settings that never leave this machine and are never taken from the
/// repo: absolute paths the app turns into file grants at launch, secrets, a
/// data endpoint, a capability switch, a prompt about this machine, and two
/// safety checks a hostile remote could otherwise switch off.
const NEVER_SYNC: [(&str, &str); 9] = [
    ("behavior", "recentFiles"),
    ("behavior", "openTabs"),
    ("behavior", "activeTabPath"),
    ("behavior", "defaultAppPrompt"),
    ("behavior", "confirmExternalLinks"),
    ("behavior", "checkForUpdates"),
    ("ai", "apiKeys"),
    ("ai", "ollamaUrl"),
    ("ai", "agentWriteTools"),
];

pub(super) fn is_synced_group(name: &str) -> bool {
    SYNCED_GROUPS.contains(&name)
}

fn never_syncs(group: &str, key: &str) -> bool {
    NEVER_SYNC.iter().any(|(g, k)| *g == group && *k == key)
}

/// `value` without the keys of `group` that never sync.
fn portable(group: &str, value: &Object) -> Object {
    without_prototype_keys(value)
        .into_iter()
        .filter(|(key, _)| !never_syncs(group, key))
        .collect()
}

/// Keys a JavaScript object assignment treats as its prototype, not as data.
const PROTOTYPE_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// `value` without those keys at any depth: written into a renderer object
/// they would swap its prototype, and with it every default it falls back to.
pub(super) fn without_prototype_keys(value: &Object) -> Object {
    value
        .iter()
        .filter(|(key, _)| !PROTOTYPE_KEYS.contains(&key.as_str()))
        .map(|(key, v)| (key.clone(), clean(v)))
        .collect()
}

fn clean(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(without_prototype_keys(map)),
        Value::Array(items) => Value::Array(items.iter().map(clean).collect()),
        other => other.clone(),
    }
}

/// What the repo should hold for the store's settings: each synced group
/// the store has, without its never-sync keys.
pub(super) fn export(store: &Object) -> BTreeMap<&'static str, Object> {
    SYNCED_GROUPS
        .iter()
        .filter_map(|&group| match store.get(group) {
            Some(Value::Object(value)) => Some((group, portable(group, value))),
            _ => None,
        })
        .collect()
}

/// The store after a pull: `base` is what this machine's repo held before
/// the sync, `merged` what it holds after. Groups outside the synced set,
/// never-sync keys, and groups whose file is `unreadable` keep their local
/// values whatever the files say.
pub(super) fn import(
    store: &Object,
    base: &BTreeMap<String, Object>,
    merged: &BTreeMap<String, Object>,
    unreadable: &BTreeSet<String>,
) -> Object {
    let mut next = store.clone();
    for group in landing_groups(unreadable) {
        let base_group = base.get(group).map(|v| Value::Object(portable(group, v)));
        let merged_group = merged.get(group).map(|v| Value::Object(portable(group, v)));
        match three_way(base_group.as_ref(), store.get(group), merged_group.as_ref()) {
            Some(value) => next.insert(group.to_string(), value),
            None => next.remove(group),
        };
    }
    next
}

/// "Use the synced setup": every synced group exactly as the repo holds it
/// (a group the repo lacks is back to defaults), keeping only this machine's
/// never-sync keys, and its own value of a group whose file is `unreadable`.
pub(super) fn adopt(
    store: &Object,
    merged: &BTreeMap<String, Object>,
    unreadable: &BTreeSet<String>,
) -> Object {
    let mut next = store.clone();
    for group in landing_groups(unreadable) {
        let mut taken = merged
            .get(group)
            .map(|v| portable(group, v))
            .unwrap_or_default();
        if let Some(Value::Object(local)) = store.get(group) {
            for (key, value) in local {
                if never_syncs(group, key) {
                    taken.insert(key.clone(), value.clone());
                }
            }
        }
        if taken.is_empty() {
            next.remove(group);
        } else {
            next.insert(group.to_string(), Value::Object(taken));
        }
    }
    next
}

/// The synced groups a pull may change: a file that is there but could not
/// be read says nothing about its group, so that group stays as it is.
fn landing_groups(unreadable: &BTreeSet<String>) -> impl Iterator<Item = &'static str> + '_ {
    SYNCED_GROUPS
        .into_iter()
        .filter(|group| !unreadable.contains(*group))
}

/// Three-way merge of one value. Where both sides are objects the merge
/// goes key by key; anything else (a scalar, an array, a value that is
/// missing on one side) is a leaf, taken from `merged` only when this
/// machine left it as `base` had it. `None` is absent, and absent wins the
/// same way: a key removed upstream goes, unless it changed here.
pub(super) fn three_way(
    base: Option<&Value>,
    store: Option<&Value>,
    merged: Option<&Value>,
) -> Option<Value> {
    if let (Some(Value::Object(store)), Some(Value::Object(merged))) = (store, merged) {
        let base = match base {
            Some(Value::Object(base)) => Some(base),
            _ => None,
        };
        let keys: BTreeSet<&String> = store
            .keys()
            .chain(merged.keys())
            .chain(base.into_iter().flat_map(|b| b.keys()))
            .collect();
        let mut out = Object::new();
        for key in keys {
            let value = three_way(
                base.and_then(|b| b.get(key)),
                store.get(key),
                merged.get(key),
            );
            if let Some(value) = value {
                out.insert(key.clone(), value);
            }
        }
        return Some(Value::Object(out));
    }
    if store == base {
        merged.cloned()
    } else {
        store.cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::object;
    use super::*;
    use serde_json::json;

    fn none() -> BTreeSet<String> {
        BTreeSet::new()
    }

    fn files(value: Value) -> BTreeMap<String, Object> {
        object(value)
            .into_iter()
            .map(|(k, v)| (k, object(v)))
            .collect()
    }

    #[test]
    fn export_leaves_out_never_sync_keys_and_unsynced_groups() {
        let store = object(json!({
            "appearance": {"theme": "dark"},
            "behavior": {
                "autoSave": true,
                "recentFiles": ["C:/notes/a.md"],
                "openTabs": [{"kind": "file", "path": "C:/a.md"}],
                "activeTabPath": "C:/a.md",
                "defaultAppPrompt": "never",
                "confirmExternalLinks": false,
                "checkForUpdates": false
            },
            "ai": {"model": "m", "apiKeys": {"claude": "k"}, "ollamaUrl": "http://x", "agentWriteTools": {"a": true}},
            "privacy": {"errorReporting": true},
            "keybindings": "not an object"
        }));
        let out = export(&store);
        assert_eq!(
            out.keys().copied().collect::<Vec<_>>(),
            ["ai", "appearance", "behavior"]
        );
        assert_eq!(
            Value::Object(out["behavior"].clone()),
            json!({"autoSave": true})
        );
        assert_eq!(Value::Object(out["ai"].clone()), json!({"model": "m"}));
    }

    #[test]
    fn a_remote_change_lands_where_this_machine_left_the_setting_alone() {
        let base = files(json!({"appearance": {"theme": "light", "fontSize": 14}}));
        let merged = files(json!({"appearance": {"theme": "light", "fontSize": 16}}));
        let store = object(json!({"appearance": {"theme": "light", "fontSize": 14}}));
        let next = import(&store, &base, &merged, &none());
        assert_eq!(
            next["appearance"],
            json!({"theme": "light", "fontSize": 16})
        );
    }

    #[test]
    fn a_setting_changed_here_during_the_sync_is_kept() {
        let base = files(json!({"appearance": {"theme": "light", "fontSize": 14}}));
        let merged = files(json!({"appearance": {"theme": "light", "fontSize": 16}}));
        let store = object(json!({"appearance": {"theme": "light", "fontSize": 20}}));
        let next = import(&store, &base, &merged, &none());
        assert_eq!(next["appearance"]["fontSize"], json!(20));
    }

    #[test]
    fn a_key_removed_upstream_goes_unless_it_changed_here() {
        let base =
            files(json!({"keybindings": {"overrides": {"save": "Ctrl+S", "find": "Ctrl+F"}}}));
        let merged = files(json!({"keybindings": {"overrides": {"find": "Ctrl+F"}}}));
        let store =
            object(json!({"keybindings": {"overrides": {"save": "Ctrl+S", "find": "Ctrl+F"}}}));
        let next = import(&store, &base, &merged, &none());
        assert_eq!(
            next["keybindings"],
            json!({"overrides": {"find": "Ctrl+F"}})
        );

        let edited =
            object(json!({"keybindings": {"overrides": {"save": "Ctrl+Alt+S", "find": "Ctrl+F"}}}));
        let next = import(&edited, &base, &merged, &none());
        assert_eq!(
            next["keybindings"]["overrides"]["save"],
            json!("Ctrl+Alt+S")
        );
    }

    #[test]
    fn a_group_removed_upstream_goes_back_to_defaults() {
        let base = files(json!({"print": {"includeToc": true}}));
        let store = object(json!({"print": {"includeToc": true}}));
        let next = import(&store, &base, &BTreeMap::new(), &none());
        assert!(!next.contains_key("print"));
    }

    #[test]
    fn never_sync_keys_and_other_groups_keep_their_local_values() {
        let hostile = files(json!({
            "behavior": {"recentFiles": ["\\\\attacker\\share\\x.md"], "confirmExternalLinks": false, "autoSave": false},
            "ai": {"ollamaUrl": "https://attacker.example", "agentWriteTools": {"write": true}},
            "privacy": {"errorReporting": true}
        }));
        let store = object(json!({
            "behavior": {"recentFiles": ["C:/a.md"], "confirmExternalLinks": true, "autoSave": true},
            "ai": {"ollamaUrl": "http://localhost:11434"},
            "privacy": {"errorReporting": false}
        }));
        for next in [
            import(&store, &BTreeMap::new(), &hostile, &none()),
            adopt(&store, &hostile, &none()),
        ] {
            assert_eq!(next["behavior"]["recentFiles"], json!(["C:/a.md"]));
            assert_eq!(next["behavior"]["confirmExternalLinks"], json!(true));
            assert_eq!(next["ai"]["ollamaUrl"], json!("http://localhost:11434"));
            assert!(next["ai"].get("agentWriteTools").is_none());
            assert_eq!(next["privacy"], json!({"errorReporting": false}));
        }
    }

    #[test]
    fn adopting_takes_every_synced_group_as_the_repo_has_it() {
        let merged = files(json!({"appearance": {"theme": "dark"}}));
        let store = object(json!({
            "appearance": {"theme": "light", "fontSize": 20},
            "editor": {"keymap": "vim"},
            "behavior": {"autoSave": true, "recentFiles": ["C:/a.md"]}
        }));
        let next = adopt(&store, &merged, &none());
        assert_eq!(next["appearance"], json!({"theme": "dark"}));
        assert!(!next.contains_key("editor"));
        assert_eq!(next["behavior"], json!({"recentFiles": ["C:/a.md"]}));
    }

    #[test]
    fn a_group_whose_file_could_not_be_read_stays_as_it_is() {
        let base = files(json!({"print": {"includeToc": true}}));
        let store = object(json!({"print": {"includeToc": true}}));
        let unreadable: BTreeSet<String> = ["print".to_string()].into();
        assert_eq!(import(&store, &base, &BTreeMap::new(), &unreadable), store);
        assert_eq!(adopt(&store, &BTreeMap::new(), &unreadable), store);
    }

    #[test]
    fn three_way_treats_arrays_as_one_value() {
        let base = json!({"langs": ["en"]});
        let store = json!({"langs": ["en"]});
        let merged = json!({"langs": ["en", "fa"]});
        assert_eq!(
            three_way(Some(&base), Some(&store), Some(&merged)),
            Some(json!({"langs": ["en", "fa"]}))
        );
    }

    #[test]
    fn a_group_new_on_both_sides_merges_key_by_key() {
        let merged = json!({"a": 1, "b": 2});
        let store = json!({"b": 3, "c": 4});
        assert_eq!(
            three_way(None, Some(&store), Some(&merged)),
            Some(json!({"a": 1, "b": 3, "c": 4}))
        );
    }

    #[test]
    fn prototype_keys_never_land_at_any_depth() {
        let hostile = files(json!({
            "appearance": {"__proto__": {"theme": "x"}, "theme": "dark"},
            "keybindings": {"overrides": {"constructor": "a", "save": "Mod+S"}},
            "editor": {"spellCheckLanguages": [{"prototype": 1}]}
        }));
        for next in [
            import(&Object::new(), &BTreeMap::new(), &hostile, &none()),
            adopt(&Object::new(), &hostile, &none()),
        ] {
            assert_eq!(next["appearance"], json!({"theme": "dark"}));
            assert_eq!(next["keybindings"], json!({"overrides": {"save": "Mod+S"}}));
            assert_eq!(next["editor"], json!({"spellCheckLanguages": [{}]}));
        }
    }

    #[test]
    fn only_the_listed_groups_are_synced() {
        assert!(is_synced_group("corePlugins"));
        assert!(!is_synced_group("privacy"));
        assert!(!is_synced_group("__proto__"));
    }
}
