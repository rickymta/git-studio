//! Launchpad: the signed-in user's open pull / merge requests and issues across every
//! repository on GitHub and gitlab.com — the ones they wrote, are assigned to, are asked to
//! review, or are mentioned in — in one list, with CI, review and mergeability for each request.
//!
//! GitHub is one GraphQL request (every search is an alias of the same query); GitLab is a
//! handful of REST calls run concurrently. Both come back in the same [`Item`] shape.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Value, json};

use crate::error::{Error, Result};

/// Requests and issues per search: plenty for "mine", and keeps the one request fast.
const PER_SEARCH: u32 = 50;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    /// CSS colour (`#rrggbb`) when the host gives one.
    pub color: Option<String>,
}

/// One pull / merge request or issue.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// Stable across refreshes: `github:owner/repo#12`, `gitlab:group/name!3`.
    pub id: String,
    /// `github` | `gitlab`.
    pub host: String,
    /// `pr` (pull or merge request) | `issue`.
    pub kind: String,
    /// `owner/repo` on GitHub, `group/sub/name` on GitLab.
    pub project: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: Option<Person>,
    pub assignees: Vec<Person>,
    pub labels: Vec<Label>,
    /// Why it is listed: `authored`, `assigned`, `reviewRequested`, `mentioned`.
    pub reasons: Vec<String>,
    pub comments: u64,
    pub reactions: u64,
    pub created_at: String,
    pub updated_at: String,
    pub draft: bool,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    /// Combined CI result of the head commit: `success` | `failure` | `pending`.
    pub ci: Option<String>,
    /// `clean` | `conflicts` | `blocked` | `unknown`.
    pub mergeable: Option<String>,
    /// `approved` | `changesRequested` | `reviewRequired`.
    pub review: Option<String>,
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("GitStudio/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

fn s(v: &Value, p: &str) -> String {
    v.pointer(p)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn opt_s(v: &Value, p: &str) -> Option<String> {
    v.pointer(p)
        .and_then(Value::as_str)
        .filter(|x| !x.is_empty())
        .map(str::to_string)
}

fn n(v: &Value, p: &str) -> u64 {
    v.pointer(p).and_then(Value::as_u64).unwrap_or(0)
}

/// Add `item` to `out`, or add its reason to the copy already there.
fn merge_into(out: &mut BTreeMap<String, Item>, item: Item) {
    match out.get_mut(&item.id) {
        Some(have) => {
            for r in item.reasons {
                if !have.reasons.contains(&r) {
                    have.reasons.push(r);
                }
            }
        }
        None => {
            out.insert(item.id.clone(), item);
        }
    }
}

/// Newest activity first.
fn finish(map: BTreeMap<String, Item>) -> Vec<Item> {
    let mut v: Vec<Item> = map.into_values().collect();
    v.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.id.cmp(&b.id)));
    v
}

// ---- GitHub -------------------------------------------------------------------------------------

const GH_FIELDS: &str = "number title url createdAt updatedAt \
    author { login avatarUrl } repository { nameWithOwner } \
    assignees(first: 6) { nodes { login avatarUrl } } \
    comments { totalCount } reactions { totalCount } \
    labels(first: 6) { nodes { name color } }";

/// The searches, as (alias, reason, query). `{me}` is the viewer's login.
const GH_SEARCHES: &[(&str, &str, &str)] = &[
    ("prAuthored", "authored", "is:pr author:{me}"),
    ("prAssigned", "assigned", "is:pr assignee:{me}"),
    ("prReview", "reviewRequested", "is:pr review-requested:{me}"),
    ("prMentioned", "mentioned", "is:pr mentions:{me}"),
    ("issueAuthored", "authored", "is:issue author:{me}"),
    ("issueAssigned", "assigned", "is:issue assignee:{me}"),
    ("issueMentioned", "mentioned", "is:issue mentions:{me}"),
];

fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The GraphQL document for every search of `login`.
pub fn github_query(login: &str) -> String {
    let mut q = String::from("fragment P on PullRequest { ");
    q.push_str(GH_FIELDS);
    q.push_str(
        " isDraft headRefName baseRefName mergeable reviewDecision \
         commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }\n",
    );
    q.push_str("fragment I on Issue { ");
    q.push_str(GH_FIELDS);
    q.push_str(" }\nquery {\n");
    for (alias, _, search) in GH_SEARCHES {
        let search = format!("is:open archived:false {}", search.replace("{me}", login));
        q.push_str(&format!(
            "  {alias}: search(query: \"{search}\", type: ISSUE, first: {PER_SEARCH}) \
             {{ nodes {{ __typename ...P ...I }} }}\n"
        ));
    }
    q.push('}');
    q
}

fn gh_person(v: &Value) -> Option<Person> {
    let login = opt_s(v, "/login")?;
    Some(Person {
        login,
        avatar_url: s(v, "/avatarUrl"),
    })
}

fn gh_ci(state: &str) -> Option<String> {
    Some(
        match state {
            "SUCCESS" => "success",
            "FAILURE" | "ERROR" => "failure",
            "PENDING" | "EXPECTED" => "pending",
            _ => return None,
        }
        .into(),
    )
}

/// One search result node as an [`Item`] (`None` for anything that is not a PR or an issue).
pub fn github_item(v: &Value, reason: &str) -> Option<Item> {
    let kind = match v.get("__typename").and_then(Value::as_str)? {
        "PullRequest" => "pr",
        "Issue" => "issue",
        _ => return None,
    };
    let project = opt_s(v, "/repository/nameWithOwner")?;
    let number = n(v, "/number");
    let pr = kind == "pr";
    let list = |p: &str| -> Vec<Value> {
        v.pointer(p)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    Some(Item {
        id: format!("github:{project}#{number}"),
        host: "github".into(),
        kind: kind.into(),
        project,
        number,
        title: s(v, "/title"),
        url: s(v, "/url"),
        author: v.get("author").and_then(gh_person),
        assignees: list("/assignees/nodes")
            .iter()
            .filter_map(gh_person)
            .collect(),
        labels: list("/labels/nodes")
            .iter()
            .filter_map(|l| {
                Some(Label {
                    name: opt_s(l, "/name")?,
                    color: opt_s(l, "/color").map(|c| format!("#{c}")),
                })
            })
            .collect(),
        reasons: vec![reason.into()],
        comments: n(v, "/comments/totalCount"),
        reactions: n(v, "/reactions/totalCount"),
        created_at: s(v, "/createdAt"),
        updated_at: s(v, "/updatedAt"),
        draft: v.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        head_ref: pr.then(|| opt_s(v, "/headRefName")).flatten(),
        base_ref: pr.then(|| opt_s(v, "/baseRefName")).flatten(),
        ci: v
            .pointer("/commits/nodes/0/commit/statusCheckRollup/state")
            .and_then(Value::as_str)
            .and_then(gh_ci),
        mergeable: pr
            .then(|| {
                v.get("mergeable").and_then(Value::as_str).map(|m| {
                    match m {
                        "MERGEABLE" => "clean",
                        "CONFLICTING" => "conflicts",
                        _ => "unknown",
                    }
                    .to_string()
                })
            })
            .flatten(),
        review: v
            .get("reviewDecision")
            .and_then(Value::as_str)
            .and_then(|r| {
                Some(
                    match r {
                        "APPROVED" => "approved",
                        "CHANGES_REQUESTED" => "changesRequested",
                        "REVIEW_REQUIRED" => "reviewRequired",
                        _ => return None,
                    }
                    .to_string(),
                )
            }),
    })
}

/// Every item in a GraphQL response's `data`.
pub fn github_items_from(data: &Value) -> Vec<Item> {
    let mut out = BTreeMap::new();
    for (alias, reason, _) in GH_SEARCHES {
        let nodes = data
            .pointer(&format!("/{alias}/nodes"))
            .and_then(Value::as_array);
        for node in nodes.into_iter().flatten() {
            if let Some(item) = github_item(node, reason) {
                merge_into(&mut out, item);
            }
        }
    }
    finish(out)
}

async fn github_graphql(token: &str, query: &str) -> Result<Value> {
    let res = client()?
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .json(&json!({ "query": query }))
        .send()
        .await?;
    let status = res.status();
    let v: Value = res.json().await.unwrap_or(Value::Null);
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(Error::GitHub(
            "GitHub rejected the token. Sign in again.".into(),
        ));
    }
    let first_error = v
        .pointer("/errors/0/message")
        .and_then(Value::as_str)
        .map(str::to_string);
    match v.get("data") {
        // Partial results (one search failed) still show the rest.
        Some(d) if !d.is_null() => Ok(d.clone()),
        _ => Err(Error::GitHub(format!(
            "GitHub {}: {}",
            status.as_u16(),
            first_error
                .or_else(|| v.get("message").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| "request failed".into())
        ))),
    }
}

/// The signed-in GitHub user's open requests and issues.
pub async fn github() -> Result<Vec<Item>> {
    let token = crate::github::load_token()?
        .ok_or_else(|| Error::GitHub("Not signed in to GitHub".into()))?;
    let me = github_graphql(&token, "query { viewer { login } }").await?;
    let login = s(&me, "/viewer/login");
    if !valid_login(&login) {
        return Err(Error::GitHub("Could not read the GitHub account".into()));
    }
    let data = github_graphql(&token, &github_query(&login)).await?;
    Ok(github_items_from(&data))
}

// ---- GitLab -------------------------------------------------------------------------------------

const GITLAB_API: &str = "https://gitlab.com/api/v4";

async fn gitlab_get(token: &str, path: &str) -> Result<Value> {
    let res = client()?
        .get(format!("{GITLAB_API}{path}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| Error::GitHub(format!("Could not reach GitLab: {e}")))?;
    let status = res.status();
    let v: Value = res.json().await.unwrap_or(Value::Null);
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(Error::GitHub(
            "GitLab 401: GitLab rejected the token. Sign in again.".into(),
        ));
    }
    if !status.is_success() {
        let msg = v
            .get("message")
            .or_else(|| v.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("request failed");
        return Err(Error::GitHub(format!("GitLab {}: {msg}", status.as_u16())));
    }
    Ok(v)
}

fn gl_person(v: &Value) -> Option<Person> {
    let login = opt_s(v, "/username")?;
    Some(Person {
        login,
        avatar_url: s(v, "/avatar_url"),
    })
}

/// A merge request (`kind` = `pr`) or issue from the REST API as an [`Item`].
pub fn gitlab_item(v: &Value, kind: &str, reason: &str) -> Option<Item> {
    let full = opt_s(v, "/references/full")?;
    let sep = if kind == "pr" { '!' } else { '#' };
    let project = full.rsplit_once(sep)?.0.to_string();
    let number = n(v, "/iid");
    let pr = kind == "pr";
    let status = s(v, "/detailed_merge_status");
    Some(Item {
        id: format!("gitlab:{project}{sep}{number}"),
        host: "gitlab".into(),
        kind: kind.into(),
        project,
        number,
        title: s(v, "/title"),
        url: s(v, "/web_url"),
        author: v.get("author").and_then(gl_person),
        assignees: v
            .get("assignees")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(gl_person).collect())
            .unwrap_or_default(),
        labels: v
            .get("labels")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(|l| Label {
                        name: l.to_string(),
                        color: None,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        reasons: vec![reason.into()],
        comments: n(v, "/user_notes_count"),
        reactions: n(v, "/upvotes") + n(v, "/downvotes"),
        created_at: s(v, "/created_at"),
        updated_at: s(v, "/updated_at"),
        draft: v
            .get("draft")
            .or_else(|| v.get("work_in_progress"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        head_ref: pr.then(|| opt_s(v, "/source_branch")).flatten(),
        base_ref: pr.then(|| opt_s(v, "/target_branch")).flatten(),
        // The list API has no pipeline; the merge status says when one is still running.
        ci: (pr && status == "ci_still_running").then(|| "pending".to_string()),
        mergeable: pr.then(|| {
            let m = match status.as_str() {
                "mergeable" => "clean",
                "conflict" | "need_rebase" | "broken_status" => "conflicts",
                "" | "unchecked" | "checking" | "preparing" => "unknown",
                _ => "blocked",
            };
            if v.get("has_conflicts").and_then(Value::as_bool) == Some(true) {
                "conflicts".to_string()
            } else {
                m.to_string()
            }
        }),
        review: None,
    })
}

/// Items from a `/todos` list: pending mentions of open requests and issues.
pub fn gitlab_mentions(todos: &Value) -> Vec<Item> {
    todos
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|t| {
                    matches!(
                        t.get("action_name").and_then(Value::as_str),
                        Some("mentioned" | "directly_addressed")
                    ) && t.pointer("/target/state").and_then(Value::as_str) == Some("opened")
                })
                .filter_map(|t| {
                    let kind = match t.get("target_type").and_then(Value::as_str)? {
                        "MergeRequest" => "pr",
                        "Issue" => "issue",
                        _ => return None,
                    };
                    gitlab_item(t.get("target")?, kind, "mentioned")
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The signed-in gitlab.com user's open merge requests and issues.
pub async fn gitlab() -> Result<Vec<Item>> {
    let token = crate::gitlab::load_token()?
        .ok_or_else(|| Error::GitHub("Not signed in to GitLab".into()))?;
    let me = gitlab_get(&token, "/user").await?;
    let id = n(&me, "/id");
    let t = token.as_str();
    let mr = |q: String| async move {
        gitlab_get(
            t,
            &format!("/merge_requests?state=opened&per_page={PER_SEARCH}&{q}"),
        )
        .await
    };
    let issues = |q: &'static str| async move {
        gitlab_get(
            t,
            &format!("/issues?state=opened&per_page={PER_SEARCH}&{q}"),
        )
        .await
    };
    let (mr_authored, mr_assigned, mr_review, is_authored, is_assigned, todos) = tokio::try_join!(
        mr("scope=created_by_me".into()),
        mr("scope=assigned_to_me".into()),
        mr(format!("scope=all&reviewer_id={id}")),
        issues("scope=created_by_me"),
        issues("scope=assigned_to_me"),
        gitlab_get(t, "/todos?state=pending&per_page=100"),
    )?;
    let mut out = BTreeMap::new();
    let lists = [
        (&mr_authored, "pr", "authored"),
        (&mr_assigned, "pr", "assigned"),
        (&mr_review, "pr", "reviewRequested"),
        (&is_authored, "issue", "authored"),
        (&is_assigned, "issue", "assigned"),
    ];
    for (list, kind, reason) in lists {
        for v in list.as_array().into_iter().flatten() {
            if let Some(item) = gitlab_item(v, kind, reason) {
                merge_into(&mut out, item);
            }
        }
    }
    for item in gitlab_mentions(&todos) {
        merge_into(&mut out, item);
    }
    Ok(finish(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gh_pr(number: u64, updated: &str) -> Value {
        json!({
            "__typename": "PullRequest",
            "number": number,
            "title": "Add login",
            "url": format!("https://github.com/acme/web/pull/{number}"),
            "createdAt": "2026-11-01T10:00:00Z",
            "updatedAt": updated,
            "author": { "login": "bob", "avatarUrl": "https://a/bob.png" },
            "repository": { "nameWithOwner": "acme/web" },
            "assignees": { "nodes": [{ "login": "amy", "avatarUrl": "https://a/amy.png" }] },
            "comments": { "totalCount": 3 },
            "reactions": { "totalCount": 2 },
            "labels": { "nodes": [{ "name": "bug", "color": "d73a4a" }] },
            "isDraft": false,
            "headRefName": "login",
            "baseRefName": "main",
            "mergeable": "CONFLICTING",
            "reviewDecision": "APPROVED",
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "FAILURE" } } }] }
        })
    }

    #[test]
    fn query_has_every_search_for_the_login() {
        let q = github_query("octo-cat");
        assert!(q.contains(
            "prReview: search(query: \"is:open archived:false is:pr review-requested:octo-cat\""
        ));
        assert!(q.contains("issueMentioned:"));
        assert_eq!(q.matches("search(").count(), GH_SEARCHES.len());
        assert!(valid_login("octo-cat"));
        assert!(!valid_login("a\" b"));
        assert!(!valid_login(""));
    }

    #[test]
    fn github_pull_request_fields() {
        let item = github_item(&gh_pr(7, "2026-11-20T10:00:00Z"), "authored").unwrap();
        assert_eq!(item.id, "github:acme/web#7");
        assert_eq!(item.kind, "pr");
        assert_eq!(item.ci.as_deref(), Some("failure"));
        assert_eq!(item.mergeable.as_deref(), Some("conflicts"));
        assert_eq!(item.review.as_deref(), Some("approved"));
        assert_eq!(item.head_ref.as_deref(), Some("login"));
        assert_eq!(item.labels[0].color.as_deref(), Some("#d73a4a"));
        assert_eq!(item.assignees[0].login, "amy");
        assert_eq!((item.comments, item.reactions), (3, 2));
    }

    #[test]
    fn github_issue_has_no_pull_request_fields_and_unknown_nodes_are_skipped() {
        let v = json!({
            "__typename": "Issue", "number": 3, "title": "Crash",
            "repository": { "nameWithOwner": "acme/web" }, "updatedAt": "2026-11-02T00:00:00Z",
            "author": null
        });
        let item = github_item(&v, "assigned").unwrap();
        assert_eq!(item.kind, "issue");
        assert!(item.author.is_none() && item.head_ref.is_none() && item.mergeable.is_none());
        assert!(github_item(&json!({ "__typename": "Discussion" }), "authored").is_none());
        // Search results for repositories the token cannot see come back as empty objects.
        assert!(github_item(&json!({}), "authored").is_none());
    }

    #[test]
    fn same_item_from_several_searches_is_listed_once_with_every_reason() {
        let data = json!({
            "prAuthored": { "nodes": [gh_pr(7, "2026-11-20T10:00:00Z"), gh_pr(9, "2026-11-21T10:00:00Z")] },
            "prReview": { "nodes": [gh_pr(7, "2026-11-20T10:00:00Z")] },
            "prMentioned": { "nodes": [gh_pr(7, "2026-11-20T10:00:00Z")] },
            "issueAuthored": null
        });
        let items = github_items_from(&data);
        assert_eq!(items.len(), 2);
        // Newest first.
        assert_eq!(items[0].number, 9);
        assert_eq!(
            items[1].reasons,
            vec!["authored", "reviewRequested", "mentioned"]
        );
    }

    #[test]
    fn gitlab_merge_request_and_issue() {
        let mr = json!({
            "iid": 4, "title": "Draft: Payments", "web_url": "https://gitlab.com/g/s/app/-/merge_requests/4",
            "references": { "full": "g/s/app!4" }, "draft": true,
            "author": { "username": "bob", "avatar_url": "https://a/b.png" },
            "assignees": [{ "username": "amy", "avatar_url": "" }],
            "labels": ["backend"], "user_notes_count": 5, "upvotes": 1, "downvotes": 1,
            "source_branch": "pay", "target_branch": "main",
            "detailed_merge_status": "ci_still_running", "has_conflicts": false,
            "updated_at": "2026-11-20T00:00:00Z"
        });
        let item = gitlab_item(&mr, "pr", "assigned").unwrap();
        assert_eq!(item.id, "gitlab:g/s/app!4");
        assert_eq!(item.project, "g/s/app");
        assert!(item.draft);
        assert_eq!(item.ci.as_deref(), Some("pending"));
        assert_eq!(item.mergeable.as_deref(), Some("blocked"));
        assert_eq!((item.comments, item.reactions), (5, 2));
        assert_eq!(item.labels[0].name, "backend");

        let conflicted = json!({ "iid": 5, "references": { "full": "g/app!5" },
            "detailed_merge_status": "mergeable", "has_conflicts": true });
        assert_eq!(
            gitlab_item(&conflicted, "pr", "authored")
                .unwrap()
                .mergeable
                .as_deref(),
            Some("conflicts")
        );

        let issue = json!({ "iid": 12, "title": "Bug", "references": { "full": "g/app#12" } });
        let item = gitlab_item(&issue, "issue", "authored").unwrap();
        assert_eq!(item.id, "gitlab:g/app#12");
        assert!(item.mergeable.is_none() && item.ci.is_none());
    }

    #[test]
    fn gitlab_mentions_keep_open_targets_only() {
        let todos = json!([
            { "action_name": "mentioned", "target_type": "Issue",
              "target": { "iid": 1, "state": "opened", "references": { "full": "g/app#1" } } },
            { "action_name": "directly_addressed", "target_type": "MergeRequest",
              "target": { "iid": 2, "state": "opened", "references": { "full": "g/app!2" } } },
            { "action_name": "mentioned", "target_type": "Issue",
              "target": { "iid": 3, "state": "closed", "references": { "full": "g/app#3" } } },
            { "action_name": "assigned", "target_type": "Issue",
              "target": { "iid": 4, "state": "opened", "references": { "full": "g/app#4" } } }
        ]);
        let ids: Vec<String> = gitlab_mentions(&todos).into_iter().map(|i| i.id).collect();
        assert_eq!(ids, vec!["gitlab:g/app#1", "gitlab:g/app!2"]);
    }
}
