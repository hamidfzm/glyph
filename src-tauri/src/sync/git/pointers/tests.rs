use super::*;
use crate::grants::GrantRegistry;
use crate::vault::test_support::link_folder;
use tempfile::TempDir;

// A host under `.invalid` cannot exist, should a refusal ever come late.
const SHARE: &str = "//glyph-test-host.invalid/share";

/// Builds a fixture in the folder it is given.
type Build = fn(&Path);

fn refuse_remote(grants: &GrantRegistry, path: &Path) -> Result<(), String> {
    let spelled: &str = &path.to_string_lossy();
    grants.refuse_remote(spelled)
}

fn check_with(grants: &GrantRegistry, folder: &Path) -> Result<(), String> {
    refuse_remote_pointers(folder, &|path: &Path| refuse_remote(grants, path))
}

fn check(folder: &Path) -> Result<(), String> {
    check_with(&GrantRegistry::default(), folder)
}

fn check_tree(folder: &Path) -> Result<(), String> {
    let grants = GrantRegistry::default();
    let judge = |path: &Path| refuse_remote(&grants, path);
    refuse_remote_pointers_with_submodules(folder, &judge)
}

fn declare_submodule(folder: &Path, path: &str) {
    let declared = format!("[submodule \"s\"]\n\tpath = {path}\n\turl = ../s.git\n");
    write(&folder.join(".gitmodules"), &declared);
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn init(folder: &Path) -> git2::Repository {
    fs::create_dir_all(folder).unwrap();
    git2::Repository::init(folder).unwrap()
}

fn append_config(folder: &Path, text: &str) {
    let path = folder.join(".git").join("config");
    let mut config = fs::read_to_string(&path).unwrap();
    config.push_str(text);
    fs::write(path, config).unwrap();
}

#[test]
fn a_pointer_file_naming_a_network_path_is_refused() {
    let cases: [(&str, Build); 10] = [
        ("gitdir line", |ws| {
            write(&ws.join(".git"), &format!("gitdir: {SHARE}/x.git\n"));
        }),
        ("gitdir line with backslashes", |ws| {
            let line = r"gitdir: \\glyph-test-host.invalid\share\x.git";
            write(&ws.join(".git"), line);
        }),
        ("commondir in .git", |ws| {
            write(&ws.join(".git/commondir"), &format!("{SHARE}/common\n"));
        }),
        ("commondir beside the notes", |ws| {
            write(&ws.join("commondir"), &format!("{SHARE}/common\n"));
        }),
        ("gitdir file in .git", |ws| {
            init(ws);
            write(&ws.join(".git/gitdir"), &format!("{SHARE}/wt/.git\n"));
        }),
        // The `.git` file leads somewhere local, which names the share.
        ("gitdir file of a linked worktree", |ws| {
            write(&ws.join(".git"), "gitdir: ../admin\n");
            write(&ws.join("../admin/gitdir"), &format!("{SHARE}/wt/.git\n"));
        }),
        ("commondir of a linked worktree", |ws| {
            write(&ws.join(".git"), "gitdir: ../admin\n");
            write(&ws.join("../admin/commondir"), &format!("{SHARE}/common\n"));
        }),
        ("alternates", |ws| {
            init(ws);
            let alternates = ws.join(".git/objects/info/alternates");
            write(&alternates, &format!("{SHARE}/objects\n"));
        }),
        ("alternates of a local alternate", |ws| {
            init(ws);
            write(&ws.join(".git/objects/info/alternates"), "../../store\n");
            let theirs = ws.join("store/info/alternates");
            write(&theirs, &format!("# shared\n{SHARE}/objects\n"));
        }),
        ("config of a bare repository", |ws| {
            write(&ws.join("HEAD"), "ref: refs/heads/main\n");
            write(
                &ws.join("config"),
                &format!("[core]\n\tworktree = {SHARE}/wt\n"),
            );
        }),
    ];
    for (name, build) in cases {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        build(&ws);
        // As the app spells a root, and as `canonicalize` does.
        for folder in [ws.clone(), ws.canonicalize().unwrap()] {
            let refusal = check(&folder).unwrap_err();
            assert!(refusal.contains("never looked up"), "{name}: {refusal}");
        }
    }
}

// Each spelling is one libgit2 itself reads as a path starting with two
// separators, which is asked of it here: reading a value looks nothing up.
#[test]
fn a_config_value_naming_a_network_path_is_refused_however_it_is_spelled() {
    let spellings = [
        "\tworktree = //glyph-test-host.invalid/share/wt\n",
        "worktree=//glyph-test-host.invalid/share/wt\n",
        "\tworktree = \"//glyph-test-host.invalid/share/wt\"\n",
        "\tworktree = /\"/\"glyph-test-host.invalid/share/wt\n",
        "\tworktree = \\\\\\\\glyph-test-host.invalid\\\\share\\\\wt\n",
        "\tworktree = /\\\\glyph-test-host.invalid/share/wt\n",
        "\tworktree = \\\n//glyph-test-host.invalid/share/wt\n",
        "\tworktree = /\\\n/glyph-test-host.invalid/share/wt\n",
        "\tworktree = /\\  \r\n/glyph-test-host.invalid/share/wt\n",
        "\tworktree = //glyph-test-host.invalid/share/wt ; elsewhere\n",
        // What libgit2 trims or skips between the two halves of a value.
        "\tworktree = /\\\x0c\n/glyph-test-host.invalid/share/wt\n",
        "\tworktree = /\\\x0b\n/glyph-test-host.invalid/share/wt\n",
        "\tworktree = /\\ ; note\n/glyph-test-host.invalid/share/wt\n",
        "\tworktree = /\\\n# note\n/glyph-test-host.invalid/share/wt\n",
        "\tworktree = /\\\n  \n/glyph-test-host.invalid/share/wt\n",
        "\tworktree = \\\n# note\n//glyph-test-host.invalid/share/wt\n",
        "\tworktree = \\\\\\\n\\\\glyph-test-host.invalid\\\\share\\\\wt\n",
    ];
    for spelling in spellings {
        let tmp = TempDir::new().unwrap();
        init(tmp.path());
        append_config(tmp.path(), &format!("[core]\n{spelling}"));

        let config = git2::Config::open(&tmp.path().join(".git/config")).unwrap();
        let read = config.get_string("core.worktree").unwrap();
        assert!(
            matches!(read.as_bytes(), [b'/' | b'\\', b'/' | b'\\', ..]),
            "{spelling:?} reads as {read:?}"
        );

        let refusal = check(tmp.path()).unwrap_err();
        assert!(
            refusal.contains("never looked up"),
            "{spelling:?}: {refusal}"
        );
    }
}

#[test]
fn a_network_path_is_refused_under_any_key_and_in_either_config_file() {
    let cases: [(&str, Build); 5] = [
        ("excludesfile", |ws| {
            append_config(ws, &format!("[core]\n\texcludesfile = {SHARE}/ignore\n"));
        }),
        ("attributesfile", |ws| {
            append_config(ws, &format!("[core]\n\tattributesfile = {SHARE}/attrs\n"));
        }),
        ("origin", |ws| {
            append_config(ws, &format!("[remote \"origin\"]\n\turl = {SHARE}/n.git\n"));
        }),
        ("insteadOf", |ws| {
            let rewrite = format!("[url \"{SHARE}/n\"]\n\tinsteadOf = https://example.com\n");
            append_config(ws, &rewrite);
        }),
        ("config.worktree", |ws| {
            let config = ws.join(".git/config.worktree");
            write(&config, &format!("[core]\n\tworktree = {SHARE}/wt\n"));
        }),
    ];
    for (name, build) in cases {
        let tmp = TempDir::new().unwrap();
        init(tmp.path());
        build(tmp.path());
        let refusal = check(tmp.path()).unwrap_err();
        assert!(refusal.contains("never looked up"), "{name}: {refusal}");
    }
}

#[test]
fn a_config_that_includes_other_files_is_refused() {
    let sections = [
        "[include]\n\tpath = ../shared.gitconfig\n",
        "[INCLUDE]\n\tpath = ../shared.gitconfig\n",
        "[includeIf \"gitdir:**\"]\n\tpath = ../shared.gitconfig\n",
        "[core]\n\tbare = false\n[include] path = ../shared.gitconfig\n",
    ];
    for section in sections {
        let tmp = TempDir::new().unwrap();
        init(tmp.path());
        append_config(tmp.path(), section);
        let refusal = check(tmp.path()).unwrap_err();
        assert!(
            refusal.contains("includes other files"),
            "{section:?}: {refusal}"
        );
    }
}

#[test]
fn a_pointer_that_cannot_be_placed_is_refused() {
    let cases: [(&str, Build); 4] = [
        ("drive-relative", |ws| {
            write(&ws.join(".git"), "gitdir: C:elsewhere\n")
        }),
        ("rooted without a drive", |ws| {
            write(&ws.join(".git"), "gitdir: /elsewhere\n");
        }),
        ("behind the extended-length prefix", |ws| {
            write(&ws.join(".git/commondir"), r"\\?\C:\a\..\elsewhere");
        }),
        ("alternate relative to the current folder", |ws| {
            init(ws);
            write(&ws.join(".git/objects/info/alternates"), "store\n");
        }),
    ];
    for (name, build) in cases {
        let tmp = TempDir::new().unwrap();
        build(tmp.path());
        let refusal = check(tmp.path()).unwrap_err();
        assert!(
            refusal.contains("not a path Git writes"),
            "{name}: {refusal}"
        );
    }
}

#[test]
fn a_linked_git_folder_is_refused_unread() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let elsewhere = tmp.path().join("elsewhere");
    init(&elsewhere);
    link_folder(&elsewhere.join(".git"), &ws.join(".git"));

    let refusal = check(&ws).unwrap_err();
    assert!(refusal.contains("is a link"), "{refusal}");
}

fn commit(repo: &git2::Repository) {
    let tree = repo.index().unwrap().write_tree().unwrap();
    let tree = repo.find_tree(tree).unwrap();
    let who = git2::Signature::now("Test User", "test@example.com").unwrap();
    repo.commit(Some("HEAD"), &who, &who, "first", &tree, &[])
        .unwrap();
}

#[test]
fn what_git_itself_writes_is_accepted() {
    let tmp = TempDir::new().unwrap();

    let plain = tmp.path().join("plain");
    write(&plain.join("note.md"), "# hi");
    check_tree(&plain).unwrap();

    // A repository with an https origin, a comment, and object stores it
    // borrows from by relative and by absolute path.
    let main = tmp.path().join("main");
    let repo = init(&main);
    commit(&repo);
    repo.remote("origin", "https://example.com/notes.git")
        .unwrap();
    append_config(&main, "# see https://example.com/setup\n");
    let store = tmp.path().join("store").join("objects");
    fs::create_dir_all(&store).unwrap();
    let borrowed = format!("../../../store/objects\n{}\n", store.display());
    write(&main.join(".git/objects/info/alternates"), &borrowed);
    check_tree(&main).unwrap();

    // A linked worktree: a `.git` file, then `commondir` and `gitdir`.
    let linked = tmp.path().join("linked");
    repo.worktree("linked", &linked, None).unwrap();
    check_tree(&linked).unwrap();
    git2::Repository::open(&linked).unwrap();

    // A submodule: a relative `.git` file, and `core.worktree` back.
    declare_submodule(&main, "sub");
    write(&main.join("sub/.git"), "gitdir: ../.git/modules/sub\n");
    let module = main.join(".git/modules/sub/config");
    write(&module, "[core]\n\tworktree = ../../../sub\n");
    check_tree(&main).unwrap();
}

#[test]
fn a_share_that_holds_a_grant_stays_reachable() {
    let tmp = TempDir::new().unwrap();
    init(tmp.path());
    let grants = GrantRegistry::default();
    grants
        .grant_resolved_workspace(PathBuf::from("//glyph-trusted.invalid/notes/vault"))
        .unwrap();
    let gitdir = tmp.path().join(".git/gitdir");

    // Judged, never read: nothing here looks the share up.
    write(&gitdir, "//glyph-trusted.invalid/notes/vault/wt/.git\n");
    check_with(&grants, tmp.path()).unwrap();

    write(&gitdir, "//glyph-trusted.invalid/other/wt/.git\n");
    let refusal = check_with(&grants, tmp.path()).unwrap_err();
    assert!(refusal.contains("never looked up"), "{refusal}");
}

// Wherever its path leads: libgit2 opens `<working tree>/<path>/.git`.
#[test]
fn a_submodule_naming_a_network_path_is_refused() {
    for path in ["notes/sub", "../outside"] {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path().join("ws");
        init(&ws);
        declare_submodule(&ws, path);
        let dot_git = ws.join(path).join(".git");
        write(&dot_git, &format!("gitdir: {SHARE}/x.git\n"));

        // Opening the parent alone reads nothing of the submodule.
        check(&ws).unwrap();
        let refusal = check_tree(&ws).unwrap_err();
        assert!(refusal.contains("never looked up"), "{path}: {refusal}");
    }
}

#[test]
fn a_submodule_of_a_submodule_is_reached() {
    let tmp = TempDir::new().unwrap();
    init(tmp.path());
    declare_submodule(tmp.path(), "sub");
    let sub = tmp.path().join("sub");
    init(&sub);
    declare_submodule(&sub, "deeper");
    let dot_git = sub.join("deeper/.git");
    write(&dot_git, &format!("gitdir: {SHARE}/x.git\n"));

    let refusal = check_tree(tmp.path()).unwrap_err();
    assert!(refusal.contains("never looked up"), "{refusal}");
}

#[test]
fn what_gitmodules_itself_points_at_is_refused() {
    let cases = [
        (
            "includes other files",
            "[include]\n\tpath = ../shared\n".to_string(),
        ),
        (
            "never looked up",
            format!("[submodule \"s\"]\n\tpath = {SHARE}/s\n"),
        ),
        (
            "not a submodule Git writes",
            "[submodule \"s\"]\n\tpath = C:/s\n".into(),
        ),
    ];
    for (reason, gitmodules) in cases {
        let tmp = TempDir::new().unwrap();
        init(tmp.path());
        write(&tmp.path().join(".gitmodules"), &gitmodules);
        let refusal = check_tree(tmp.path()).unwrap_err();
        assert!(refusal.contains(reason), "{gitmodules:?}: {refusal}");
    }
}
