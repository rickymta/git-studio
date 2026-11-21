//! Dev-only HTTP bridge: `POST /call {cmd, args}` on 127.0.0.1:1421, so the UI served by Vite can
//! drive the real backend from a normal browser. Never shipped (feature `dev-bridge`).

use axum::Json;
use axum::Router;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use serde_json::Value;

async fn call(Json(body): Json<Value>) -> Response {
    let cmd = body
        .get("cmd")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let args = body.get("args").cloned().unwrap_or(Value::Null);
    match gitstudio_core::dispatch(&cmd, args).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::to_value(&e).unwrap_or_default()),
        )
            .into_response(),
    }
}

/// The Vite dev server on any local port (1420 is often taken by another project's dev server).
fn local_origin(origin: Option<&HeaderValue>) -> HeaderValue {
    origin
        .filter(|o| {
            o.to_str().is_ok_and(|s| {
                ["http://localhost:", "http://127.0.0.1:"].iter().any(|p| {
                    s.strip_prefix(p)
                        .is_some_and(|port| port.parse::<u16>().is_ok())
                })
            })
        })
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("http://localhost:1420"))
}

async fn cors(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let origin = local_origin(req.headers().get(header::ORIGIN));
    let mut res = if req.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(req).await
    };
    let h = res.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    h.insert(header::VARY, HeaderValue::from_static("origin"));
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST, OPTIONS"),
    );
    res
}

#[tokio::main]
async fn main() {
    // Same as the app: the overlay refresher started by Preferences in dev runs this binary.
    if std::env::args().any(|a| a == "--overlay-serve") {
        tokio::task::spawn_blocking(gitstudio_core::overlay::serve)
            .await
            .ok();
        return;
    }
    std::thread::spawn(|| {
        loop {
            gitstudio_core::overlay::tick();
            std::thread::sleep(gitstudio_core::overlay::INTERVAL);
        }
    });
    let app = Router::new()
        .route(
            "/call",
            post(call).options(|| async { StatusCode::NO_CONTENT }),
        )
        .layer(axum::middleware::from_fn(cors));
    // GITSTUDIO_BRIDGE_PORT runs a second bridge beside one already on 1421 (pair it with
    // VITE_BRIDGE_PORT for the UI).
    let port: u16 = std::env::var("GITSTUDIO_BRIDGE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(1421);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap_or_else(|e| panic!("bind {port}: {e}"));
    println!("GitStudio dev bridge on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.expect("serve");
}
