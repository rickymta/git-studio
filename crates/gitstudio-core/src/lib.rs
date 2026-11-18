//! GitStudio core: everything the UI calls goes through [`dispatch`], so the Tauri shell and the
//! dev HTTP bridge share one command surface.

pub mod credentials;
pub mod error;
pub mod git;
pub mod github;
pub mod gitkraken;
pub mod gitlab;
pub mod settings;
pub mod ssh;
pub mod terminal;
pub mod text;
pub mod workspace;

use std::path::PathBuf;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

pub use error::{Error, Result};
use git::Repo;

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T> {
    let v = args.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(v).map_err(|e| Error::Invalid(format!("argument `{key}`: {e}")))
}

fn opt<T: DeserializeOwned>(args: &Value, key: &str) -> Result<Option<T>> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => serde_json::from_value(v.clone())
            .map(Some)
            .map_err(|e| Error::Invalid(format!("argument `{key}`: {e}"))),
    }
}

async fn repo(args: &Value) -> Result<Repo> {
    let path: String = arg(args, "repo")?;
    Repo::open(&PathBuf::from(path)).await
}

/// Stored GitHub token, if any. Network git commands use it for github.com remotes.
fn token() -> Option<String> {
    github::load_token().ok().flatten()
}

fn done() -> Result<Value> {
    Ok(Value::Null)
}

/// Run one UI command. `args` is a JSON object; the result is JSON.
pub async fn dispatch(cmd: &str, args: Value) -> Result<Value> {
    let a = &args;
    Ok(match cmd {
        // ---- app ----
        "app.gitVersion" => json!(git::version().await?),
        // ---- SSH ----
        "ssh.info" => serde_json::to_value(ssh::info().await?)?,
        "ssh.save" => {
            let s: ssh::SshSettings = arg(a, "ssh")?;
            let mut all = settings::load();
            all.ssh = s;
            settings::save(&all)?;
            serde_json::to_value(ssh::info().await?)?
        }
        "ssh.generate" => {
            let comment: Option<String> = opt(a, "comment")?;
            let pass: Option<String> = opt(a, "passphrase")?;
            serde_json::to_value(
                ssh::generate(
                    &arg::<String>(a, "name")?,
                    comment.as_deref().unwrap_or(""),
                    pass.as_deref().unwrap_or(""),
                )
                .await?,
            )?
        }
        "ssh.test" => {
            let host: Option<String> = opt(a, "host")?;
            serde_json::to_value(ssh::test(host.as_deref().unwrap_or("github.com")).await?)?
        }

        // ---- workspaces ----
        "workspace.list" => serde_json::to_value(workspace::load())?,
        "workspace.save" => {
            let w: workspace::Workspaces = arg(a, "workspaces")?;
            workspace::save(&w)?;
            serde_json::to_value(workspace::load())?
        }
        "workspace.scan" => {
            let root: String = arg(a, "root")?;
            let depth: Option<u32> = opt(a, "depth")?;
            let root = PathBuf::from(root);
            let depth = depth.unwrap_or(3).min(6);
            json!(
                tokio::task::spawn_blocking(move || workspace::scan(&root, depth))
                    .await
                    .map_err(|e| Error::Invalid(e.to_string()))?
            )
        }
        "workspace.status" => {
            let repos: Vec<String> = arg(a, "repos")?;
            serde_json::to_value(workspace::status(repos).await)?
        }
        "app.openTerminal" => {
            git::open_terminal(
                &PathBuf::from(arg::<String>(a, "path")?),
                &settings::load().terminal,
            )?;
            return done();
        }
        "settings.get" => serde_json::to_value(settings::load())?,
        "settings.set" => {
            let s: settings::Settings = arg(a, "settings")?;
            serde_json::to_value(settings::save_preferences(s)?)?
        }
        // Global config, or the given repository's own (local) config when `repo` is set.
        "gitconfig.get" => {
            let keys: Vec<String> = arg(a, "keys")?;
            let r = match opt::<String>(a, "repo")? {
                Some(p) => Some(Repo::open(&PathBuf::from(p)).await?),
                None => None,
            };
            let mut out = serde_json::Map::new();
            for k in keys {
                let v = git::config_get(r.as_ref(), &k).await?;
                out.insert(k, json!(v));
            }
            Value::Object(out)
        }
        "gitconfig.set" => {
            let value: Option<String> = opt(a, "value")?;
            let r = match opt::<String>(a, "repo")? {
                Some(p) => Some(Repo::open(&PathBuf::from(p)).await?),
                None => None,
            };
            git::config_set(r.as_ref(), &arg::<String>(a, "key")?, value.as_deref()).await?;
            return done();
        }
        "credentials.list" => {
            let r = match opt::<String>(a, "repo")? {
                Some(p) => Some(Repo::open(&PathBuf::from(p)).await?),
                None => None,
            };
            serde_json::to_value(credentials::hosts(r.as_ref()).await?)?
        }
        "credentials.save" => {
            credentials::save(
                &arg::<String>(a, "host")?,
                &arg::<String>(a, "username")?,
                &arg::<String>(a, "password")?,
            )
            .await?;
            return done();
        }
        "credentials.erase" => {
            credentials::erase(&arg::<String>(a, "host")?).await?;
            return done();
        }
        "gitkraken.detect" => match gitkraken::read() {
            None => Value::Null,
            Some(d) => json!({
                "repos": d.repos.len(),
                "tabs": d.tabs.len(),
                "ssh": d.ssh_private_key.is_some(),
            }),
        },
        "gitkraken.import" => {
            let ssh: Option<bool> = opt(a, "ssh")?;
            serde_json::to_value(gitkraken::import(ssh.unwrap_or(true))?)?
        }
        "app.openEditor" => {
            git::open_in_editor(
                &settings::load().external_editor,
                &PathBuf::from(arg::<String>(a, "path")?),
            )?;
            return done();
        }
        "settings.forgetRecent" => {
            serde_json::to_value(settings::forget_recent(&arg::<String>(a, "path")?)?)?
        }

        // ---- repository ----
        "repo.open" => {
            let r = repo(a).await?;
            let info = r.info().await?;
            settings::touch_recent(&info.path, &info.name)?;
            serde_json::to_value(info)?
        }
        "repo.init" => {
            let path: String = arg(a, "path")?;
            let branch: Option<String> = opt(a, "branch")?;
            let default_branch = settings::load().default_branch;
            let r = git::init(
                &PathBuf::from(path),
                branch
                    .as_deref()
                    .filter(|b| !b.is_empty())
                    .unwrap_or(&default_branch),
            )
            .await?;
            let info = r.info().await?;
            settings::touch_recent(&info.path, &info.name)?;
            serde_json::to_value(info)?
        }
        "repo.clone" => {
            let url: String = arg(a, "url")?;
            let dest: String = arg(a, "dest")?;
            let opts: Option<git::CloneOptions> = opt(a, "options")?;
            let r = git::clone_with(
                &url,
                &PathBuf::from(dest),
                token().as_deref(),
                opts.unwrap_or_default(),
            )
            .await?;
            let info = r.info().await?;
            settings::touch_recent(&info.path, &info.name)?;
            serde_json::to_value(info)?
        }
        "repo.info" => serde_json::to_value(repo(a).await?.info().await?)?,
        "repo.log" => {
            let limit: Option<u32> = opt(a, "limit")?;
            let skip: Option<u32> = opt(a, "skip")?;
            serde_json::to_value(
                repo(a)
                    .await?
                    .log(limit.unwrap_or(1000).min(20_000), skip.unwrap_or(0))
                    .await?,
            )?
        }
        "repo.refs" => serde_json::to_value(repo(a).await?.refs().await?)?,
        "repo.commit" => serde_json::to_value(
            repo(a)
                .await?
                .commit_detail(&arg::<String>(a, "hash")?)
                .await?,
        )?,
        "repo.diff" => {
            let req: git::DiffRequest = arg(a, "request")?;
            json!(repo(a).await?.diff(&req).await?)
        }
        // ---- files, blame, history ----
        "file.read" => {
            let rev: Option<String> = opt(a, "rev")?;
            let enc: Option<String> = opt(a, "encoding")?;
            serde_json::to_value(
                repo(a)
                    .await?
                    .read_file(&arg::<String>(a, "path")?, rev.as_deref(), enc.as_deref())
                    .await?,
            )?
        }
        "file.write" => {
            let format: text::TextFormat = arg(a, "format")?;
            repo(a).await?.write_file(
                &arg::<String>(a, "path")?,
                &arg::<String>(a, "content")?,
                &format,
            )?;
            return done();
        }
        "file.encodings" => json!(text::COMMON),
        "repo.blame" => {
            let rev: Option<String> = opt(a, "rev")?;
            serde_json::to_value(
                repo(a)
                    .await?
                    .blame(&arg::<String>(a, "path")?, rev.as_deref())
                    .await?,
            )?
        }
        "repo.fileHistory" => {
            let limit: Option<u32> = opt(a, "limit")?;
            serde_json::to_value(
                repo(a)
                    .await?
                    .file_history(&arg::<String>(a, "path")?, limit.unwrap_or(500))
                    .await?,
            )?
        }
        "repo.listFiles" => {
            serde_json::to_value(repo(a).await?.list_files(&arg::<String>(a, "rev")?).await?)?
        }
        "repo.compare" => serde_json::to_value(
            repo(a)
                .await?
                .compare_with_worktree(&arg::<String>(a, "hash")?)
                .await?,
        )?,
        "history.reword" => {
            repo(a)
                .await?
                .reword(&arg::<String>(a, "hash")?, &arg::<String>(a, "message")?)
                .await?;
            return done();
        }
        "history.drop" => {
            repo(a)
                .await?
                .drop_commit(&arg::<String>(a, "hash")?)
                .await?;
            return done();
        }
        "patch.create" => {
            repo(a)
                .await?
                .create_patch(
                    &arg::<String>(a, "hash")?,
                    &PathBuf::from(arg::<String>(a, "dest")?),
                )
                .await?;
            return done();
        }
        "patch.apply" => {
            repo(a)
                .await?
                .apply_patch_file(&PathBuf::from(arg::<String>(a, "file")?))
                .await?;
            return done();
        }

        // ---- worktrees ----
        "worktree.list" => serde_json::to_value(repo(a).await?.worktrees().await?)?,
        "worktree.add" => {
            let req: git::files::NewWorktree = arg(a, "request")?;
            repo(a).await?.add_worktree(&req).await?;
            return done();
        }
        "worktree.remove" => {
            let force: Option<bool> = opt(a, "force")?;
            repo(a)
                .await?
                .remove_worktree(&arg::<String>(a, "path")?, force.unwrap_or(false))
                .await?;
            return done();
        }
        "worktree.lock" => {
            repo(a)
                .await?
                .lock_worktree(&arg::<String>(a, "path")?, arg(a, "lock")?)
                .await?;
            return done();
        }
        "worktree.prune" => {
            repo(a).await?.prune_worktrees().await?;
            return done();
        }

        "repo.identity" => serde_json::to_value(repo(a).await?.identity().await?)?,
        "repo.setIdentity" => {
            repo(a)
                .await?
                .set_identity(
                    &arg::<String>(a, "name")?,
                    &arg::<String>(a, "email")?,
                    arg(a, "global")?,
                )
                .await?;
            return done();
        }
        "repo.headMessage" => json!(repo(a).await?.head_message().await?),

        // ---- working tree ----
        "index.stage" => {
            repo(a)
                .await?
                .stage(&arg::<Vec<String>>(a, "paths")?)
                .await?;
            return done();
        }
        "index.unstage" => {
            repo(a)
                .await?
                .unstage(&arg::<Vec<String>>(a, "paths")?)
                .await?;
            return done();
        }
        "index.discard" => {
            let tracked: Vec<String> = opt(a, "tracked")?.unwrap_or_default();
            let untracked: Vec<String> = opt(a, "untracked")?.unwrap_or_default();
            repo(a).await?.discard(&tracked, &untracked).await?;
            return done();
        }
        "index.applyPatch" => {
            repo(a)
                .await?
                .apply_patch(
                    &arg::<String>(a, "patch")?,
                    arg(a, "cached")?,
                    arg(a, "reverse")?,
                    opt::<String>(a, "encoding")?.as_deref(),
                )
                .await?;
            return done();
        }
        "index.commit" => {
            let amend: Option<bool> = opt(a, "amend")?;
            repo(a)
                .await?
                .commit(&arg::<String>(a, "message")?, amend.unwrap_or(false))
                .await?;
            return done();
        }
        "index.resolve" => {
            repo(a)
                .await?
                .resolve(&arg::<Vec<String>>(a, "paths")?, &arg::<String>(a, "side")?)
                .await?;
            return done();
        }
        "op.abort" => {
            repo(a).await?.abort().await?;
            return done();
        }
        "op.continue" => {
            repo(a).await?.continue_op().await?;
            return done();
        }

        // ---- branches & history edits ----
        "branch.checkout" => {
            let kind: git::CheckoutKind = arg(a, "kind")?;
            repo(a)
                .await?
                .checkout(&arg::<String>(a, "target")?, kind)
                .await?;
            return done();
        }
        "branch.create" => {
            let start: Option<String> = opt(a, "start")?;
            let checkout: Option<bool> = opt(a, "checkout")?;
            repo(a)
                .await?
                .create_branch(
                    &arg::<String>(a, "name")?,
                    start.as_deref(),
                    checkout.unwrap_or(true),
                )
                .await?;
            return done();
        }
        "branch.delete" => {
            let force: Option<bool> = opt(a, "force")?;
            repo(a)
                .await?
                .delete_branch(&arg::<String>(a, "name")?, force.unwrap_or(false))
                .await?;
            return done();
        }
        "branch.rename" => {
            repo(a)
                .await?
                .rename_branch(&arg::<String>(a, "old")?, &arg::<String>(a, "new")?)
                .await?;
            return done();
        }
        "branch.setUpstream" => {
            let up: Option<String> = opt(a, "upstream")?;
            repo(a)
                .await?
                .set_upstream(&arg::<String>(a, "branch")?, up.as_deref())
                .await?;
            return done();
        }
        "branch.deleteRemote" => {
            repo(a)
                .await?
                .delete_remote_ref(
                    &arg::<String>(a, "remote")?,
                    &arg::<String>(a, "name")?,
                    token().as_deref(),
                )
                .await?;
            return done();
        }
        "history.merge" => {
            let no_ff: Option<bool> = opt(a, "noFf")?;
            repo(a)
                .await?
                .merge(&arg::<String>(a, "target")?, no_ff.unwrap_or(false))
                .await?;
            return done();
        }
        "history.rebase" => {
            repo(a).await?.rebase(&arg::<String>(a, "onto")?).await?;
            return done();
        }
        "history.cherryPick" => {
            let m: Option<bool> = opt(a, "isMerge")?;
            repo(a)
                .await?
                .cherry_pick(&arg::<String>(a, "hash")?, m.unwrap_or(false))
                .await?;
            return done();
        }
        "history.revert" => {
            let m: Option<bool> = opt(a, "isMerge")?;
            repo(a)
                .await?
                .revert(&arg::<String>(a, "hash")?, m.unwrap_or(false))
                .await?;
            return done();
        }
        "history.reset" => {
            repo(a)
                .await?
                .reset(&arg::<String>(a, "target")?, &arg::<String>(a, "mode")?)
                .await?;
            return done();
        }

        // ---- tags & stash ----
        "tag.create" => {
            let msg: Option<String> = opt(a, "message")?;
            repo(a)
                .await?
                .create_tag(
                    &arg::<String>(a, "name")?,
                    &arg::<String>(a, "target")?,
                    msg.as_deref(),
                )
                .await?;
            return done();
        }
        "tag.delete" => {
            repo(a)
                .await?
                .delete_tag(&arg::<String>(a, "name")?)
                .await?;
            return done();
        }
        "stash.save" => {
            let msg: Option<String> = opt(a, "message")?;
            let untracked: Option<bool> = opt(a, "includeUntracked")?;
            repo(a)
                .await?
                .stash_save(msg.as_deref(), untracked.unwrap_or(true))
                .await?;
            return done();
        }
        "stash.op" => {
            repo(a)
                .await?
                .stash_op(&arg::<String>(a, "op")?, arg(a, "index")?)
                .await?;
            return done();
        }

        // ---- remotes ----
        "remote.fetch" => {
            let remote: Option<String> = opt(a, "remote")?;
            repo(a)
                .await?
                .fetch(remote.as_deref(), token().as_deref())
                .await?;
            return done();
        }
        "remote.pull" => {
            let mode: Option<String> = opt(a, "mode")?;
            let mode = mode.unwrap_or_else(|| settings::load().pull_mode);
            repo(a).await?.pull(&mode, token().as_deref()).await?;
            return done();
        }
        "remote.push" => {
            let req: git::PushRequest = opt(a, "request")?.unwrap_or_default();
            repo(a).await?.push(&req, token().as_deref()).await?;
            return done();
        }
        "remote.add" => {
            repo(a)
                .await?
                .add_remote(&arg::<String>(a, "name")?, &arg::<String>(a, "url")?)
                .await?;
            return done();
        }
        "remote.setUrl" => {
            repo(a)
                .await?
                .set_remote_url(&arg::<String>(a, "name")?, &arg::<String>(a, "url")?)
                .await?;
            return done();
        }
        "remote.remove" => {
            repo(a)
                .await?
                .remove_remote(&arg::<String>(a, "name")?)
                .await?;
            return done();
        }

        // ---- GitHub ----
        "github.account" => match token() {
            None => Value::Null,
            Some(t) => match github::Api::new(t).user().await {
                Ok(u) => serde_json::to_value(u)?,
                // Token revoked or expired: behave as signed out.
                Err(Error::GitHub(msg)) if msg.contains("401") => Value::Null,
                Err(e) => return Err(e),
            },
        },
        // ---- in-app terminal ----
        "terminal.open" => {
            let cols: Option<u16> = opt(a, "cols")?;
            let rows: Option<u16> = opt(a, "rows")?;
            serde_json::to_value(terminal::open(
                &PathBuf::from(arg::<String>(a, "cwd")?),
                cols.unwrap_or(100),
                rows.unwrap_or(24),
            )?)?
        }
        "terminal.read" => serde_json::to_value(terminal::read(arg(a, "id")?)?)?,
        "terminal.write" => {
            terminal::write(arg(a, "id")?, &arg::<String>(a, "data")?)?;
            return done();
        }
        "terminal.resize" => {
            terminal::resize(arg(a, "id")?, arg(a, "cols")?, arg(a, "rows")?)?;
            return done();
        }
        "terminal.close" => {
            terminal::close(arg(a, "id")?)?;
            return done();
        }

        // ---- GitLab ----
        "gitlab.account" => match gitlab::load_token()? {
            None => Value::Null,
            Some(t) => match gitlab::user(&t).await {
                Ok(u) => serde_json::to_value(u)?,
                Err(Error::GitHub(msg)) if msg.contains("401") => Value::Null,
                Err(e) => return Err(e),
            },
        },
        "gitlab.signInToken" => {
            serde_json::to_value(gitlab::sign_in_with_token(&arg::<String>(a, "token")?).await?)?
        }
        "gitlab.importToken" => serde_json::to_value(gitlab::import_token().await?)?,
        "gitlab.signOut" => {
            gitlab::delete_token()?;
            return done();
        }
        "gitlab.repos" => {
            let page: Option<u32> = opt(a, "page")?;
            serde_json::to_value(gitlab::projects(page.unwrap_or(1)).await?)?
        }
        "github.importToken" => {
            let source: String = arg(a, "source")?;
            serde_json::to_value(github::import_token(&source).await?)?
        }
        "github.keys" => serde_json::to_value(github::Api::stored()?.keys().await?)?,
        "github.addKey" => serde_json::to_value(
            github::Api::stored()?
                .add_key(&arg::<String>(a, "title")?, &arg::<String>(a, "key")?)
                .await?,
        )?,
        "github.deleteKey" => {
            github::Api::stored()?.delete_key(arg(a, "id")?).await?;
            return done();
        }
        "github.signInToken" => {
            serde_json::to_value(github::sign_in_with_token(&arg::<String>(a, "token")?).await?)?
        }
        "github.deviceStart" => {
            let id: Option<String> = opt(a, "clientId")?;
            let id = id
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| settings::load().github_client_id);
            serde_json::to_value(github::device_start(&id).await?)?
        }
        "github.devicePoll" => {
            let id: Option<String> = opt(a, "clientId")?;
            let id = id
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| settings::load().github_client_id);
            serde_json::to_value(github::device_poll(&id, &arg::<String>(a, "deviceCode")?).await?)?
        }
        "github.signOut" => {
            github::delete_token()?;
            return done();
        }
        "github.repos" => {
            let page: Option<u32> = opt(a, "page")?;
            serde_json::to_value(github::Api::stored()?.repos(page.unwrap_or(1)).await?)?
        }
        "github.pulls" => serde_json::to_value(
            github::Api::stored()?
                .pulls(&arg::<String>(a, "owner")?, &arg::<String>(a, "repo")?)
                .await?,
        )?,
        "github.createPull" => {
            let pr: github::NewPullRequest = arg(a, "pr")?;
            serde_json::to_value(github::Api::stored()?.create_pull(&pr).await?)?
        }
        "github.createRepo" => {
            #[derive(Deserialize)]
            struct R {
                name: String,
                #[serde(default)]
                description: String,
                #[serde(default)]
                private: bool,
            }
            let r: R = serde_json::from_value(args.clone())?;
            serde_json::to_value(
                github::Api::stored()?
                    .create_repo(&r.name, &r.description, r.private)
                    .await?,
            )?
        }

        _ => return Err(Error::Invalid(format!("Unknown command {cmd}"))),
    })
}
