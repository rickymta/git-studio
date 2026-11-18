//! GitStudio core: everything the UI calls goes through [`dispatch`], so the Tauri shell and the
//! dev HTTP bridge share one command surface.

pub mod error;
pub mod git;
pub mod github;
pub mod settings;
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
            json!(tokio::task::spawn_blocking(move || workspace::scan(&root, depth))
                .await
                .map_err(|e| Error::Invalid(e.to_string()))?)
        }
        "workspace.status" => {
            let repos: Vec<String> = arg(a, "repos")?;
            serde_json::to_value(workspace::status(repos).await)?
        }
        "app.openTerminal" => {
            git::open_terminal(&PathBuf::from(arg::<String>(a, "path")?))?;
            return done();
        }
        "settings.get" => serde_json::to_value(settings::load())?,
        "settings.set" => {
            let s: settings::Settings = arg(a, "settings")?;
            settings::save(&s)?;
            serde_json::to_value(settings::load())?
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
            let r = git::init(&PathBuf::from(path), branch.as_deref().unwrap_or("main")).await?;
            let info = r.info().await?;
            settings::touch_recent(&info.path, &info.name)?;
            serde_json::to_value(info)?
        }
        "repo.clone" => {
            let url: String = arg(a, "url")?;
            let dest: String = arg(a, "dest")?;
            let r = git::clone(&url, &PathBuf::from(dest), token().as_deref()).await?;
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
        "repo.commit" => serde_json::to_value(repo(a).await?.commit_detail(&arg::<String>(a, "hash")?).await?)?,
        "repo.diff" => {
            let req: git::DiffRequest = arg(a, "request")?;
            json!(repo(a).await?.diff(&req).await?)
        }
        "repo.identity" => serde_json::to_value(repo(a).await?.identity().await?)?,
        "repo.setIdentity" => {
            repo(a)
                .await?
                .set_identity(&arg::<String>(a, "name")?, &arg::<String>(a, "email")?, arg(a, "global")?)
                .await?;
            return done();
        }
        "repo.headMessage" => json!(repo(a).await?.head_message().await?),

        // ---- working tree ----
        "index.stage" => {
            repo(a).await?.stage(&arg::<Vec<String>>(a, "paths")?).await?;
            return done();
        }
        "index.unstage" => {
            repo(a).await?.unstage(&arg::<Vec<String>>(a, "paths")?).await?;
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
                .apply_patch(&arg::<String>(a, "patch")?, arg(a, "cached")?, arg(a, "reverse")?)
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
            repo(a).await?.checkout(&arg::<String>(a, "target")?, kind).await?;
            return done();
        }
        "branch.create" => {
            let start: Option<String> = opt(a, "start")?;
            let checkout: Option<bool> = opt(a, "checkout")?;
            repo(a)
                .await?
                .create_branch(&arg::<String>(a, "name")?, start.as_deref(), checkout.unwrap_or(true))
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
                .delete_remote_ref(&arg::<String>(a, "remote")?, &arg::<String>(a, "name")?, token().as_deref())
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
                .create_tag(&arg::<String>(a, "name")?, &arg::<String>(a, "target")?, msg.as_deref())
                .await?;
            return done();
        }
        "tag.delete" => {
            repo(a).await?.delete_tag(&arg::<String>(a, "name")?).await?;
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
            repo(a).await?.fetch(remote.as_deref(), token().as_deref()).await?;
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
        "remote.remove" => {
            repo(a).await?.remove_remote(&arg::<String>(a, "name")?).await?;
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
        "github.signInToken" => serde_json::to_value(github::sign_in_with_token(&arg::<String>(a, "token")?).await?)?,
        "github.deviceStart" => {
            let id: Option<String> = opt(a, "clientId")?;
            let id = id.filter(|s| !s.is_empty()).unwrap_or_else(|| settings::load().github_client_id);
            serde_json::to_value(github::device_start(&id).await?)?
        }
        "github.devicePoll" => {
            let id: Option<String> = opt(a, "clientId")?;
            let id = id.filter(|s| !s.is_empty()).unwrap_or_else(|| settings::load().github_client_id);
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
