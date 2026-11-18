//! End-to-end checks against real repositories created with the `git` CLI.

use std::path::Path;

use gitstudio_core::git::model::RepoState;
use gitstudio_core::git::{self, CheckoutKind, DiffRequest, DiffSource, PushRequest, Repo};

fn sh(dir: &Path, args: &[&str]) {
    let st = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .status()
        .unwrap();
    assert!(st.success(), "git {args:?}");
}

async fn new_repo(dir: &Path) -> Repo {
    let r = git::init(dir, "main").await.unwrap();
    r.set_identity("Tester", "tester@example.com", false)
        .await
        .unwrap();
    sh(dir, &["config", "commit.gpgsign", "false"]);
    r
}

#[tokio::test]
async fn stage_commit_branch_merge_flow() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;

    // Empty repository: no history, untracked file shows up.
    assert!(r.log(100, 0).await.unwrap().is_empty());
    std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.unstaged[0].status, '?');
    let d = r
        .diff(&DiffRequest {
            source: DiffSource::Unstaged,
            path: "a.txt".into(),
            orig_path: None,
            untracked: true,
            commit: None,
            parent: None,
            ignore_whitespace: false,
            context: None,
            encoding: None,
        })
        .await
        .unwrap();
    assert!(d.contains("+one"), "{d}");

    // Stage + unstage on an unborn branch, then commit.
    r.stage(&["a.txt".into()]).await.unwrap();
    r.unstage(&["a.txt".into()]).await.unwrap();
    assert!(r.status().await.unwrap().staged.is_empty());
    r.stage(&[]).await.unwrap();
    r.commit("first", false).await.unwrap();
    let log = r.log(100, 0).await.unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].subject, "first");

    // Feature branch with a change, merge back with --no-ff.
    r.create_branch("feature/x", None, true).await.unwrap();
    std::fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("add three", false).await.unwrap();
    r.checkout("main", CheckoutKind::Branch).await.unwrap();
    r.merge("feature/x", true).await.unwrap();
    let log = r.log(100, 0).await.unwrap();
    assert_eq!(log.len(), 3);
    assert_eq!(log[0].parents.len(), 2);

    let detail = r.commit_detail(&log[1].hash).await.unwrap();
    assert_eq!(detail.files[0].path, "a.txt");
    let refs = r.refs().await.unwrap();
    assert!(refs.refs.iter().any(|x| x.name == "feature/x"));
    assert!(refs.refs.iter().any(|x| x.name == "main" && x.is_head));

    // Tags, stash, amend.
    r.create_tag("v1", "HEAD", Some("release")).await.unwrap();
    std::fs::write(dir.join("b.txt"), "b").unwrap();
    r.stash_save(Some("wip"), true).await.unwrap();
    let refs = r.refs().await.unwrap();
    assert_eq!(refs.stashes.len(), 1);
    assert_eq!(
        refs.refs.iter().find(|x| x.name == "v1").unwrap().target,
        log[0].hash
    );
    r.stash_op("pop", 0).await.unwrap();
    assert!(dir.join("b.txt").exists());
    r.discard(&[], &["b.txt".into()]).await.unwrap();
    assert!(!dir.join("b.txt").exists());
    r.commit("merge renamed", true).await.unwrap();
    assert_eq!(r.head_message().await.unwrap(), "merge renamed");
}

#[tokio::test]
async fn hunk_patch_and_conflicts() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    std::fs::write(dir.join("f.txt"), "a\nb\nc\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("base", false).await.unwrap();

    // Stage via a patch, like the hunk button does.
    std::fs::write(dir.join("f.txt"), "a\nB\nc\n").unwrap();
    let patch =
        "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n";
    r.apply_patch(patch, true, false, None).await.unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.staged.len(), 1);
    assert!(st.unstaged.is_empty());
    r.apply_patch(patch, true, true, None).await.unwrap();
    assert!(r.status().await.unwrap().staged.is_empty());
    r.discard(&["f.txt".into()], &[]).await.unwrap();

    // Conflict, inspect state, resolve with "theirs", continue.
    r.create_branch("other", None, true).await.unwrap();
    std::fs::write(dir.join("f.txt"), "a\nOTHER\nc\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("other", false).await.unwrap();
    r.checkout("main", CheckoutKind::Branch).await.unwrap();
    std::fs::write(dir.join("f.txt"), "a\nMAIN\nc\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("main", false).await.unwrap();
    assert!(r.merge("other", false).await.is_err());
    assert_eq!(r.state(), RepoState::Merging);
    assert_eq!(r.status().await.unwrap().conflicted.len(), 1);
    r.resolve(&["f.txt".into()], "theirs").await.unwrap();
    r.continue_op().await.unwrap();
    assert_eq!(r.state(), RepoState::Clean);
    assert_eq!(
        std::fs::read_to_string(dir.join("f.txt"))
            .unwrap()
            .replace("\r\n", "\n"),
        "a\nOTHER\nc\n"
    );
}

#[tokio::test]
async fn clone_push_pull_with_local_remote() {
    let tmp = tempfile::tempdir().unwrap();
    let origin = tmp.path().join("origin.git");
    std::fs::create_dir_all(&origin).unwrap();
    sh(&origin, &["init", "--bare", "-b", "main"]);

    let a_dir = tmp.path().join("a");
    let a = new_repo(&a_dir).await;
    a.add_remote("origin", origin.to_str().unwrap())
        .await
        .unwrap();
    std::fs::write(a_dir.join("x"), "1").unwrap();
    a.stage(&[]).await.unwrap();
    a.commit("one", false).await.unwrap();
    // First push sets the upstream.
    a.push(&PushRequest::default(), None).await.unwrap();
    assert_eq!(
        a.status().await.unwrap().upstream.as_deref(),
        Some("origin/main")
    );

    let b_dir = tmp.path().join("b");
    let b = git::clone(origin.to_str().unwrap(), &b_dir, None)
        .await
        .unwrap();
    b.set_identity("B", "b@example.com", false).await.unwrap();
    std::fs::write(b_dir.join("y"), "2").unwrap();
    b.stage(&[]).await.unwrap();
    b.commit("two", false).await.unwrap();
    b.push(&PushRequest::default(), None).await.unwrap();

    a.fetch(None, None).await.unwrap();
    assert_eq!(a.status().await.unwrap().behind, 1);
    a.pull("ff-only", None, None).await.unwrap();
    assert!(a_dir.join("y").exists());

    // Remote branch checkout creates a tracking branch.
    b.create_branch("topic", None, true).await.unwrap();
    b.push(&PushRequest::default(), None).await.unwrap();
    a.fetch(Some("origin"), None).await.unwrap();
    a.checkout("origin/topic", CheckoutKind::Remote)
        .await
        .unwrap();
    assert_eq!(a.status().await.unwrap().branch.as_deref(), Some("topic"));
    a.delete_remote_ref("origin", "topic", None).await.unwrap();
}

#[tokio::test]
async fn pull_and_push_choose_the_remote() {
    let tmp = tempfile::tempdir().unwrap();
    let up = tmp.path().join("upstream.git");
    let fork = tmp.path().join("fork.git");
    for d in [&up, &fork] {
        std::fs::create_dir_all(d).unwrap();
        sh(d, &["init", "--bare", "-b", "main"]);
    }

    let a_dir = tmp.path().join("a");
    let a = new_repo(&a_dir).await;
    a.add_remote("origin", fork.to_str().unwrap())
        .await
        .unwrap();
    a.add_remote("upstream", up.to_str().unwrap())
        .await
        .unwrap();
    std::fs::write(a_dir.join("x"), "1").unwrap();
    a.stage(&[]).await.unwrap();
    a.commit("one", false).await.unwrap();
    // Tracks origin; pushing to "upstream" explicitly must not touch origin.
    a.push(&PushRequest::default(), None).await.unwrap();
    a.push(
        &PushRequest {
            remote: Some("upstream".into()),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();

    // Someone else adds a commit on "upstream" only.
    let b_dir = tmp.path().join("b");
    let b = git::clone(up.to_str().unwrap(), &b_dir, None)
        .await
        .unwrap();
    b.set_identity("B", "b@example.com", false).await.unwrap();
    std::fs::write(b_dir.join("y"), "2").unwrap();
    b.stage(&[]).await.unwrap();
    b.commit("two", false).await.unwrap();
    b.push(&PushRequest::default(), None).await.unwrap();

    // Plain pull follows origin (nothing new); pulling from "upstream" brings the commit.
    a.pull("ff-only", None, None).await.unwrap();
    assert!(!a_dir.join("y").exists());
    a.pull("ff-only", Some("upstream"), None).await.unwrap();
    assert!(a_dir.join("y").exists());
    assert_eq!(
        a.status().await.unwrap().upstream.as_deref(),
        Some("origin/main")
    );

    // Rename and a separate push URL.
    a.rename_remote("upstream", "base").await.unwrap();
    a.set_remote_url("base", fork.to_str().unwrap(), true)
        .await
        .unwrap();
    let remotes = a.refs().await.unwrap().remotes;
    let base = remotes.iter().find(|r| r.name == "base").unwrap();
    assert!(base.url.contains("upstream.git"));
    assert!(base.push_url.contains("fork.git"));
}

#[tokio::test]
async fn rejects_option_injection() {
    let tmp = tempfile::tempdir().unwrap();
    let r = new_repo(&tmp.path().join("r")).await;
    assert!(
        r.checkout("--orphan=x", CheckoutKind::Branch)
            .await
            .is_err()
    );
    assert!(
        git::clone("--upload-pack=evil", &tmp.path().join("c"), None)
            .await
            .is_err()
    );
    assert!(
        git::clone("ext::sh -c evil", &tmp.path().join("c"), None)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn reword_drop_worktree_and_files() {
    use gitstudio_core::text::TextFormat;
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    for (i, name) in ["a", "b", "c"].iter().enumerate() {
        std::fs::write(dir.join(name), format!("{i}\n")).unwrap();
        r.stage(&[]).await.unwrap();
        r.commit(&format!("add {name}"), false).await.unwrap();
    }
    let log = r.log(10, 0).await.unwrap();
    // Reword an older commit, then HEAD.
    r.reword(&log[1].hash, "add b (reworded)").await.unwrap();
    let log = r.log(10, 0).await.unwrap();
    assert_eq!(log[1].subject, "add b (reworded)");
    assert_eq!(log.len(), 3);
    r.reword(&log[0].hash, "add c!").await.unwrap();
    assert_eq!(r.log(10, 0).await.unwrap()[0].subject, "add c!");
    // Drop the middle commit.
    let log = r.log(10, 0).await.unwrap();
    r.drop_commit(&log[1].hash).await.unwrap();
    let log = r.log(10, 0).await.unwrap();
    assert_eq!(log.len(), 2);
    assert!(!dir.join("b").exists());

    // Files in another encoding round-trip through read/write.
    std::fs::write(dir.join("w.txt"), b"caf\xE9\r\n").unwrap();
    let d = r.read_file("w.txt", None, None).await.unwrap();
    assert_eq!(d.text, "café\n");
    r.write_file("w.txt", "café au lait\n", &d.format).unwrap();
    assert_eq!(
        std::fs::read(dir.join("w.txt")).unwrap(),
        b"caf\xE9 au lait\r\n"
    );
    assert!(r.read_file("../x", None, None).await.is_err());

    // Blame and history.
    let blame = r.blame("a", None).await.unwrap();
    assert_eq!(blame.lines.len(), 1);
    assert_eq!(r.file_history("a", 10).await.unwrap().len(), 1);

    // Worktrees.
    let wt = tmp.path().join("wt");
    r.add_worktree(&gitstudio_core::git::files::NewWorktree {
        path: wt.display().to_string(),
        branch: None,
        new_branch: Some("side".into()),
    })
    .await
    .unwrap();
    let list = r.worktrees().await.unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[0].is_main && list[0].is_current);
    assert_eq!(list[1].branch.as_deref(), Some("side"));
    r.remove_worktree(&wt.display().to_string(), false)
        .await
        .unwrap();
    assert_eq!(r.worktrees().await.unwrap().len(), 1);
    let _ = TextFormat {
        encoding: "UTF-8".into(),
        bom: false,
        eol: "lf".into(),
    };
}

#[tokio::test]
async fn move_commits_and_filter_the_graph() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    for name in ["a", "b", "c"] {
        std::fs::write(dir.join(name), name).unwrap();
        r.stage(&[]).await.unwrap();
        r.commit(&format!("add {name}"), false).await.unwrap();
    }
    let subjects = |log: Vec<git::model::Commit>| {
        log.into_iter()
            .map(|c| c.subject)
            .collect::<Vec<_>>()
            .join(",")
    };
    // Newest first: c, b, a. Move "c" down → b is newest.
    let log = r.log(10, 0).await.unwrap();
    r.move_commit(&log[0].hash, true).await.unwrap();
    assert_eq!(subjects(r.log(10, 0).await.unwrap()), "add b,add c,add a");
    // Move the root commit "a" up → c, a order below b.
    let log = r.log(10, 0).await.unwrap();
    r.move_commit(&log[2].hash, false).await.unwrap();
    assert_eq!(subjects(r.log(10, 0).await.unwrap()), "add b,add a,add c");
    assert!(
        r.move_commit(&r.log(1, 0).await.unwrap()[0].hash, false)
            .await
            .is_err()
    );
    for f in ["a", "b", "c"] {
        assert!(dir.join(f).exists());
    }

    // Solo / hide.
    r.create_branch("side", None, true).await.unwrap();
    std::fs::write(dir.join("s"), "s").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("side work", false).await.unwrap();
    let solo = git::LogView {
        solo: vec!["refs/heads/main".into()],
        hidden: vec![],
    };
    assert_eq!(r.log_view(10, 0, &solo).await.unwrap().len(), 3);
    let hide = git::LogView {
        solo: vec![],
        hidden: vec!["refs/heads/side".into()],
    };
    assert_eq!(r.log_view(10, 0, &hide).await.unwrap().len(), 3);
    assert_eq!(r.log(10, 0).await.unwrap().len(), 4);
}
