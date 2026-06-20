//! WebSocket push server for the observer app.
//!
//! Accepts controller connections on `/observer`, authenticates them with a
//! token query parameter during the HTTP upgrade, sends the latest known
//! payload immediately, then streams every subsequent update. Decoupled from
//! Tauri (takes a status callback) so it can be unit-tested.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

/// Fan-out hub: latest payload + a broadcast channel to all connected clients.
#[derive(Clone)]
pub struct Broadcaster {
    tx: broadcast::Sender<String>,
    last: Arc<Mutex<String>>,
    clients: Arc<AtomicUsize>,
}

impl Default for Broadcaster {
    fn default() -> Self {
        Self::new()
    }
}

impl Broadcaster {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(32);
        Self {
            tx,
            last: Arc::new(Mutex::new(String::new())),
            clients: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Store and broadcast a payload to all connected controllers.
    pub fn publish(&self, msg: String) {
        *self.last.lock().unwrap() = msg.clone();
        let _ = self.tx.send(msg); // ignore "no receivers"
    }

    pub fn last(&self) -> String {
        self.last.lock().unwrap().clone()
    }

    fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}

fn query_token(uri: &tokio_tungstenite::tungstenite::http::Uri) -> Option<String> {
    uri.query()?
        .split('&')
        .find_map(|kv| kv.strip_prefix("token=").map(|v| v.to_string()))
}

/// Run the WebSocket server until the task is dropped/aborted.
pub async fn serve(
    addr: SocketAddr,
    token: String,
    bc: Broadcaster,
    on_clients: Arc<dyn Fn(usize) + Send + Sync>,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    loop {
        let (stream, _peer) = match listener.accept().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        let token = token.clone();
        let bc = bc.clone();
        let on_clients = on_clients.clone();
        tokio::spawn(async move {
            let _ = handle(stream, token, bc, on_clients).await;
        });
    }
}

async fn handle(
    stream: TcpStream,
    token: String,
    bc: Broadcaster,
    on_clients: Arc<dyn Fn(usize) + Send + Sync>,
) -> Result<(), ()> {
    let expected = token.clone();
    let ws = accept_hdr_async(stream, move |req: &Request, resp: Response| {
        let ok = query_token(req.uri()).as_deref() == Some(expected.as_str());
        if ok {
            Ok(resp)
        } else {
            let err: ErrorResponse = tokio_tungstenite::tungstenite::http::Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body(Some("invalid token".to_string()))
                .unwrap();
            Err(err)
        }
    })
    .await
    .map_err(|_| ())?;

    let (mut write, mut read) = ws.split();

    // Send the latest snapshot right away.
    let last = bc.last();
    if !last.is_empty() {
        let _ = write.send(Message::Text(last.into())).await;
    }

    let count = bc.clients.fetch_add(1, Ordering::SeqCst) + 1;
    on_clients(count);

    let mut rx = bc.subscribe();
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(text) => {
                    if write.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            incoming = read.next() => match incoming {
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}        // ignore client chatter / pings
                Some(Err(_)) => break,
            }
        }
    }

    let count = bc.clients.fetch_sub(1, Ordering::SeqCst).saturating_sub(1);
    on_clients(count);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    async fn free_port() -> SocketAddr {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap()
    }

    #[tokio::test]
    async fn valid_token_receives_latest_payload() {
        let addr = free_port().await;
        let bc = Broadcaster::new();
        bc.publish(r#"{"status":"connected"}"#.to_string());
        let noop: Arc<dyn Fn(usize) + Send + Sync> = Arc::new(|_| {});

        let server = tokio::spawn(serve(addr, "secret".into(), bc.clone(), noop));
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let url = format!("ws://{addr}/observer?token=secret");
        let (mut ws, _) = connect_async(url).await.expect("should connect");
        let msg = ws.next().await.unwrap().unwrap();
        assert!(msg.to_text().unwrap().contains("connected"));

        server.abort();
    }

    #[tokio::test]
    async fn invalid_token_is_rejected() {
        let addr = free_port().await;
        let bc = Broadcaster::new();
        let noop: Arc<dyn Fn(usize) + Send + Sync> = Arc::new(|_| {});
        let server = tokio::spawn(serve(addr, "secret".into(), bc, noop));
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let url = format!("ws://{addr}/observer?token=WRONG");
        let result = connect_async(url).await;
        assert!(result.is_err(), "bad token must be rejected at handshake");

        server.abort();
    }
}
