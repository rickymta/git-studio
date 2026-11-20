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

#[tokio::test]
async fn staged_stash_and_rename_keep_order() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    for f in ["a", "b"] {
        std::fs::write(dir.join(f), "0").unwrap();
    }
    r.stage(&[]).await.unwrap();
    r.commit("init", false).await.unwrap();

    std::fs::write(dir.join("a"), "1").unwrap();
    r.stash_save(Some("first"), true).await.unwrap();
    // Only the staged file goes into the second stash.
    std::fs::write(dir.join("a"), "2").unwrap();
    std::fs::write(dir.join("b"), "2").unwrap();
    r.stage(&["b".into()]).await.unwrap();
    r.stash_save_with(Some("Title\n\nDescription"), true, true)
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(dir.join("a")).unwrap(), "2");
    assert_eq!(std::fs::read_to_string(dir.join("b")).unwrap(), "0");

    let before = r.refs().await.unwrap().stashes;
    assert_eq!(before.len(), 2);
    r.stash_rename(1, "renamed").await.unwrap();
    let after = r.refs().await.unwrap().stashes;
    assert_eq!(after.len(), 2);
    assert_eq!(after[0].hash, before[0].hash);
    assert_eq!(after[1].hash, before[1].hash);
    assert!(
        after[1].message.ends_with("renamed"),
        "{}",
        after[1].message
    );
    assert!(after[1].message.starts_with("On main: "));
}

async fn commit_file(r: &Repo, dir: &Path, name: &str) {
    std::fs::write(dir.join(name), name).unwrap();
    r.stage(&[]).await.unwrap();
    r.commit(name, false).await.unwrap();
}

fn target_of(refs: &git::model::Refs, name: &str) -> String {
    refs.refs
        .iter()
        .find(|x| x.name == name)
        .map(|x| x.target.clone())
        .unwrap()
}

#[tokio::test]
async fn checkout_remote_reset_and_unreferenced_commits() {
    let tmp = tempfile::tempdir().unwrap();
    let up = tmp.path().join("up.git");
    std::fs::create_dir_all(&up).unwrap();
    sh(&up, &["init", "--bare", "-b", "main"]);
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    r.add_remote("origin", up.to_str().unwrap()).await.unwrap();
    commit_file(&r, &dir, "a").await;
    sh(&dir, &["push", "-q", "origin", "main"]);
    r.fetch(Some("origin"), None).await.unwrap();
    let remote_tip = target_of(&r.refs().await.unwrap(), "origin/main");

    // Local main gets a commit the remote does not have; HEAD then goes elsewhere.
    commit_file(&r, &dir, "local-only").await;
    r.create_branch("other", Some(&remote_tip), true)
        .await
        .unwrap();

    // Plain remote checkout keeps the diverged local branch as it is...
    r.checkout("origin/main", CheckoutKind::Remote)
        .await
        .unwrap();
    assert_ne!(target_of(&r.refs().await.unwrap(), "main"), remote_tip);
    // ...RemoteReset moves it onto the remote branch.
    r.checkout("other", CheckoutKind::Branch).await.unwrap();
    r.checkout("origin/main", CheckoutKind::RemoteReset)
        .await
        .unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.branch.as_deref(), Some("main"));
    assert_eq!(target_of(&r.refs().await.unwrap(), "main"), remote_tip);
    assert_eq!(st.upstream.as_deref(), Some("origin/main"));

    // A commit made on a detached HEAD belongs to no ref until a branch points at it.
    r.checkout(&remote_tip, CheckoutKind::Detached)
        .await
        .unwrap();
    assert_eq!(r.unreferenced_commits("HEAD").await.unwrap(), 0);
    commit_file(&r, &dir, "detached").await;
    assert_eq!(r.unreferenced_commits("HEAD").await.unwrap(), 1);
    r.create_branch("keep", None, false).await.unwrap();
    assert_eq!(r.unreferenced_commits("HEAD").await.unwrap(), 0);
}

#[tokio::test]
async fn reflog_lists_head_moves_and_flags_lost_commits() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    assert!(
        r.reflog(10, 0).await.unwrap().is_empty(),
        "unborn HEAD has no reflog"
    );
    commit_file(&r, &dir, "a").await;
    commit_file(&r, &dir, "b").await;
    let b = r.log(1, 0).await.unwrap()[0].hash.clone();
    // Drop b from main: only the reflog still knows it.
    r.reset("HEAD~1", "hard").await.unwrap();

    let log = r.reflog(10, 0).await.unwrap();
    assert_eq!(log[0].selector, "HEAD@{0}");
    assert!(log[0].action.starts_with("reset:"), "{:?}", log[0]);
    assert!(!log[0].unreferenced);
    let lost = log.iter().find(|e| e.hash == b).unwrap();
    assert!(lost.unreferenced);
    assert_eq!(lost.subject, "b");
    assert!(lost.time > 0);

    // Paging continues the numbering.
    let page = r.reflog(1, 1).await.unwrap();
    assert_eq!(page[0].selector, "HEAD@{1}");
    assert_eq!(page[0].hash, b);

    // A branch at the lost commit recovers it.
    r.create_branch("rescued", Some(&b), false).await.unwrap();
    assert!(
        r.reflog(10, 0)
            .await
            .unwrap()
            .iter()
            .all(|e| !e.unreferenced)
    );
}

#[tokio::test]
async fn interactive_rebase_reorders_squashes_rewords_and_drops() {
    use gitstudio_core::git::files::{RebaseAction as Act, RebaseStep};
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    for f in ["a", "b", "c", "d", "e"] {
        commit_file(&r, &dir, f).await;
    }
    let log = r.log(10, 0).await.unwrap();
    let h = |s: &str| log.iter().find(|c| c.subject == s).unwrap().hash.clone();
    // Uncommitted work survives (autostash).
    std::fs::write(dir.join("a"), "dirty").unwrap();

    let plan = r.rebase_plan(&h("b")).await.unwrap();
    let subjects: Vec<&str> = plan.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, ["b", "c", "d", "e"]);

    let step = |action, s: &str, message: Option<&str>| RebaseStep {
        action,
        hash: h(s),
        message: message.map(str::to_string),
    };
    // Missing a commit of the plan is refused.
    assert!(
        r.rebase_steps(&h("b"), &[step(Act::Pick, "b", None)])
            .await
            .is_err()
    );
    // Nothing to squash into.
    assert!(
        r.rebase_steps(
            &h("b"),
            &[
                step(Act::Squash, "b", None),
                step(Act::Pick, "c", None),
                step(Act::Pick, "d", None),
                step(Act::Pick, "e", None),
            ],
        )
        .await
        .is_err()
    );

    r.rebase_steps(
        &h("b"),
        &[
            step(Act::Pick, "d", None),
            step(Act::Squash, "c", None),
            step(Act::Reword, "b", Some("B renamed\n\nwith a body")),
            step(Act::Drop, "e", None),
        ],
    )
    .await
    .unwrap();

    let after = r.log(10, 0).await.unwrap();
    let subjects: Vec<&str> = after.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, ["B renamed", "d", "a"]);
    assert_eq!(after[0].body.trim(), "with a body");
    assert!(after[1].body.contains('c'), "squash keeps both messages");
    assert!(!dir.join("e").exists(), "dropped commit's file is gone");
    assert!(dir.join("c").exists() && dir.join("d").exists());
    assert_eq!(std::fs::read_to_string(dir.join("a")).unwrap(), "dirty");
    assert_eq!(r.state(), RepoState::Clean);
}

#[tokio::test]
async fn compare_two_branches() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    commit_file(&r, &dir, "a").await;
    r.create_branch("topic", None, true).await.unwrap();
    commit_file(&r, &dir, "t1").await;
    commit_file(&r, &dir, "t2").await;
    r.checkout("main", CheckoutKind::Branch).await.unwrap();
    commit_file(&r, &dir, "m1").await;

    let c = r.compare_commits("main", "topic").await.unwrap();
    assert_eq!((c.ahead, c.behind), (2, 1));
    let mut files: Vec<(char, &str)> = c
        .files
        .iter()
        .map(|f| (f.status, f.path.as_str()))
        .collect();
    files.sort();
    assert_eq!(files, vec![('A', "t1"), ('A', "t2"), ('D', "m1")]);
    assert!(r.compare_commits("--output=x", "main").await.is_err());
}

#[tokio::test]
async fn fast_forward_branches_without_checking_them_out() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    commit_file(&r, &dir, "a").await;
    r.create_branch("old", None, false).await.unwrap();
    r.create_branch("wt-branch", None, false).await.unwrap();
    let wt = tmp.path().join("wt");
    r.add_worktree(&gitstudio_core::git::files::NewWorktree {
        path: wt.display().to_string(),
        branch: Some("wt-branch".into()),
        new_branch: None,
    })
    .await
    .unwrap();
    commit_file(&r, &dir, "b").await;
    let tip = r.log(1, 0).await.unwrap()[0].hash.clone();

    // A plain branch moves by ref; the one checked out elsewhere moves inside its worktree.
    r.fast_forward("old", "main").await.unwrap();
    r.fast_forward("wt-branch", "main").await.unwrap();
    let refs = r.refs().await.unwrap();
    assert_eq!(target_of(&refs, "old"), tip);
    assert_eq!(target_of(&refs, "wt-branch"), tip);
    assert!(wt.join("b").exists(), "worktree files follow the branch");

    // Diverged branches are refused and left alone.
    r.checkout("old", CheckoutKind::Branch).await.unwrap();
    commit_file(&r, &dir, "c").await;
    r.checkout("main", CheckoutKind::Branch).await.unwrap();
    commit_file(&r, &dir, "d").await;
    let before = target_of(&r.refs().await.unwrap(), "old");
    assert!(r.fast_forward("old", "main").await.is_err());
    assert_eq!(target_of(&r.refs().await.unwrap(), "old"), before);
}

#[tokio::test]
async fn choose_a_credential_account_for_one_repository() {
    use gitstudio_core::credentials;
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    let key = "credential.https://example.test.username";
    let local = || {
        let out = std::process::Command::new("git")
            .current_dir(&dir)
            .args(["config", "--local", "--get", key])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };

    credentials::choose(Some(&r), "example.test", Some("bob"))
        .await
        .unwrap();
    assert_eq!(local(), "bob");
    assert!(credentials::account_chosen(&dir, "example.test").await);

    // Clearing twice is fine; bad input is refused.
    credentials::choose(Some(&r), "example.test", None)
        .await
        .unwrap();
    credentials::choose(Some(&r), "example.test", None)
        .await
        .unwrap();
    assert_eq!(local(), "");
    assert!(
        credentials::choose(Some(&r), "example.test", Some("-c"))
            .await
            .is_err()
    );
    assert!(
        credentials::choose(Some(&r), "bad host", Some("bob"))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn longpaths_default_respects_an_existing_choice() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("gitconfig");
    let get = || {
        let out = std::process::Command::new("git")
            .args(["config", "--file"])
            .arg(&file)
            .args(["--get", "core.longpaths"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };

    // Unset: turned on, once.
    assert!(git::ensure_longpaths(Some(&file)).await.unwrap());
    assert_eq!(get(), "true");
    assert!(!git::ensure_longpaths(Some(&file)).await.unwrap());

    // Turned off by the user: left off.
    std::fs::write(&file, "[core]\n\tlongpaths = false\n").unwrap();
    assert!(!git::ensure_longpaths(Some(&file)).await.unwrap());
    assert_eq!(get(), "false");
}

#[tokio::test]
async fn amend_message_keeps_staged_and_unstaged_changes_out() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    std::fs::write(dir.join("a.txt"), "one\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("first", false).await.unwrap();
    std::fs::write(dir.join("b.txt"), "two\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("second", false).await.unwrap();
    let old = r.log(10, 0).await.unwrap()[0].clone();

    // A staged edit and an unstaged one stay where they are.
    std::fs::write(dir.join("a.txt"), "one\nstaged\n").unwrap();
    r.stage(&["a.txt".into()]).await.unwrap();
    std::fs::write(dir.join("b.txt"), "two\nunstaged\n").unwrap();

    let new = r
        .amend_message(&old.hash, "second, reworded\n\nWith a body.")
        .await
        .unwrap();
    assert_ne!(new, old.hash);
    let log = r.log(10, 0).await.unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].hash, new);
    assert_eq!(log[0].subject, "second, reworded");
    assert_eq!(log[0].parents, old.parents);
    assert_eq!(log[0].author_time, old.author_time);
    let detail = r.commit_detail(&new).await.unwrap();
    assert!(detail.body.contains("With a body."), "{}", detail.body);
    // Only b.txt (the commit's own change) is in the amended commit.
    let files: Vec<_> = detail.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(files, ["b.txt"]);
    let st = r.status().await.unwrap();
    assert_eq!(st.staged.len(), 1);
    assert_eq!(st.staged[0].path, "a.txt");
    assert_eq!(st.unstaged.len(), 1);
    assert_eq!(st.unstaged[0].path, "b.txt");

    // A stale hash (HEAD moved), an older commit, an empty message or an option are refused.
    assert!(r.amend_message(&old.hash, "again").await.is_err());
    assert!(r.amend_message(&log[1].hash, "again").await.is_err());
    assert!(r.amend_message(&new, "  \n").await.is_err());
    assert!(r.amend_message("--evil", "again").await.is_err());
    assert_eq!(r.log(10, 0).await.unwrap()[0].hash, new);
}

#[tokio::test]
async fn remotes_containing_sees_a_push_without_upstream() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let remote = tmp.path().join("remote.git");
    let r = new_repo(&dir).await;
    std::fs::write(dir.join("a.txt"), "one\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("first", false).await.unwrap();
    let pushed = r.log(1, 0).await.unwrap()[0].hash.clone();

    sh(tmp.path(), &["init", "--bare", "-q", "remote.git"]);
    sh(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
    // Pushed without `-u`: the branch has no upstream, yet the commit is published.
    sh(&dir, &["push", "-q", "origin", "main"]);
    assert_eq!(
        r.remotes_containing(&pushed).await.unwrap(),
        ["origin/main"]
    );

    std::fs::write(dir.join("b.txt"), "two\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("second", false).await.unwrap();
    let local = r.log(1, 0).await.unwrap()[0].hash.clone();
    assert!(r.remotes_containing(&local).await.unwrap().is_empty());
    assert!(r.remotes_containing("--evil").await.is_err());
}

#[tokio::test]
async fn amend_message_of_a_merge_commit() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    std::fs::write(dir.join("a.txt"), "one\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("first", false).await.unwrap();
    sh(&dir, &["checkout", "-q", "-b", "side"]);
    std::fs::write(dir.join("s.txt"), "side\n").unwrap();
    sh(&dir, &["add", "."]);
    sh(&dir, &["commit", "-q", "-m", "side"]);
    sh(&dir, &["checkout", "-q", "main"]);
    std::fs::write(dir.join("m.txt"), "main\n").unwrap();
    sh(&dir, &["add", "."]);
    sh(&dir, &["commit", "-q", "-m", "main"]);
    sh(
        &dir,
        &[
            "merge",
            "-q",
            "--no-ff",
            "-m",
            "Merge branch 'side'",
            "side",
        ],
    );
    let old = r.log(10, 0).await.unwrap()[0].clone();
    assert_eq!(old.parents.len(), 2);

    let new = r
        .amend_message(&old.hash, "Merge side into main")
        .await
        .unwrap();
    let head = r.log(10, 0).await.unwrap()[0].clone();
    assert_eq!(head.hash, new);
    assert_eq!(head.subject, "Merge side into main");
    assert_eq!(head.parents, old.parents);
}

#[tokio::test]
async fn search_finds_commits_by_message_author_content_and_path() {
    use gitstudio_core::git::CommitSearch;
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/lib.rs"), "fn alpha() {}\n").unwrap();
    r.stage(&[]).await.unwrap();
    r.commit("Add Alpha parser", false).await.unwrap();
    // Another author, on a side branch the graph might not have loaded.
    sh(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("notes.txt"), "beta\n").unwrap();
    r.stage(&[]).await.unwrap();
    sh(
        &dir,
        &[
            "-c",
            "user.name=Other Person",
            "-c",
            "user.email=other@example.com",
            "commit",
            "-q",
            "-m",
            "Write notes",
        ],
    );
    sh(&dir, &["switch", "-q", "main"]);

    let find = |q: CommitSearch| {
        let r = &r;
        async move {
            r.search_commits(&q, 50)
                .await
                .unwrap()
                .into_iter()
                .map(|c| c.subject)
                .collect::<Vec<_>>()
        }
    };
    let q = |m: &str, a: &str, c: &str, p: &str| CommitSearch {
        message: m.into(),
        author: a.into(),
        content: c.into(),
        path: p.into(),
    };
    // Message, without regard to case; literal text, not a regex.
    assert_eq!(find(q("alpha", "", "", "")).await, ["Add Alpha parser"]);
    assert!(find(q("Al.ha", "", "", "")).await.is_empty());
    // Author on another branch.
    assert_eq!(find(q("", "other@", "", "")).await, ["Write notes"]);
    // Both have to match.
    assert!(find(q("alpha", "other", "", "")).await.is_empty());
    // Pickaxe and path.
    assert_eq!(find(q("", "", "fn alpha", "")).await, ["Add Alpha parser"]);
    assert_eq!(find(q("", "", "", "notes.txt")).await, ["Write notes"]);
    assert_eq!(find(q("", "", "", "src")).await, ["Add Alpha parser"]);
    // Nothing to look for.
    assert!(r.search_commits(&q(" ", "", "", ""), 50).await.is_err());
}

#[tokio::test]
async fn squash_merge_stash_options_ignore_and_clean() {
    use gitstudio_core::git::StashPush;
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("repo");
    let r = new_repo(&dir).await;
    commit_file(&r, &dir, "a").await;

    // merge --squash: the changes are staged, no merge commit, HEAD stays.
    sh(&dir, &["switch", "-q", "-c", "topic"]);
    commit_file(&r, &dir, "t1").await;
    commit_file(&r, &dir, "t2").await;
    sh(&dir, &["switch", "-q", "main"]);
    let head = r.status().await.unwrap().head;
    r.merge_squash("topic").await.unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.head, head);
    let mut staged: Vec<_> = st.staged.iter().map(|f| f.path.as_str()).collect();
    staged.sort();
    assert_eq!(staged, ["t1", "t2"]);
    r.commit("squashed topic", false).await.unwrap();

    // Stash only one file, keeping the other change in place.
    std::fs::write(dir.join("a"), "a changed").unwrap();
    std::fs::write(dir.join("t1"), "t1 changed").unwrap();
    r.stash_push(&StashPush {
        message: Some("only a".into()),
        paths: vec!["a".into()],
        ..Default::default()
    })
    .await
    .unwrap();
    let st = r.status().await.unwrap();
    let left: Vec<_> = st.unstaged.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(left, ["t1"]);

    // Keep index: the staged change is stashed and also stays staged.
    r.stage(&["t1".into()]).await.unwrap();
    r.stash_push(&StashPush {
        keep_index: true,
        ..Default::default()
    })
    .await
    .unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.staged.len(), 1);
    r.unstage(&[]).await.unwrap();
    r.discard(&["t1".into()], &[]).await.unwrap();

    // Stash to a new branch: stash@{1} is "only a", made on the squashed commit.
    r.stash_branch("from-stash", 1).await.unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.branch.as_deref(), Some("from-stash"));
    assert_eq!(std::fs::read_to_string(dir.join("a")).unwrap(), "a changed");
    assert!(r.stash_branch("bad name..", 0).await.is_err());

    // .gitignore: appended once, created when missing.
    assert!(r.add_to_gitignore("*.log").await.unwrap());
    assert!(!r.add_to_gitignore("*.log").await.unwrap());
    assert!(r.add_to_gitignore("build/").await.unwrap());
    assert_eq!(
        std::fs::read_to_string(dir.join(".gitignore")).unwrap(),
        "*.log\nbuild/\n"
    );
    assert!(r.add_to_gitignore("a\nb").await.is_err());

    // Clean: untracked files and folders; ignored ones only when asked.
    std::fs::write(dir.join("junk.txt"), "x").unwrap();
    std::fs::create_dir_all(dir.join("tmp dir")).unwrap();
    std::fs::write(dir.join("tmp dir/x"), "x").unwrap();
    std::fs::write(dir.join("debug.log"), "x").unwrap();
    let mut plain = r.clean_preview(false).await.unwrap();
    plain.sort();
    assert_eq!(plain, [".gitignore", "junk.txt", "tmp dir/"]);
    assert!(
        r.clean_preview(true)
            .await
            .unwrap()
            .contains(&"debug.log".to_string())
    );
    r.clean_paths(&["junk.txt".into(), "tmp dir/".into()], false)
        .await
        .unwrap();
    assert!(!dir.join("junk.txt").exists());
    assert!(!dir.join("tmp dir").exists());
    assert!(dir.join("debug.log").exists());
    r.clean_paths(&["debug.log".into()], true).await.unwrap();
    assert!(!dir.join("debug.log").exists());
}
