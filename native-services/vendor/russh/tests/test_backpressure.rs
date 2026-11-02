//! SimpleShell patch: client channels re-open their receive window only as the
//! application consumes data, and a stalled channel never blocks the others.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use russh::keys::PrivateKeyWithHashAlg;
use russh::keys::ssh_key::rand_core::OsRng;
use russh::server::{self, Auth, Msg, Server as _, Session};
use russh::{Channel, ChannelMsg, client};
use ssh_key::PrivateKey;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio::time::timeout;

const CLIENT_WINDOW: u32 = 64 * 1024;
const CHUNK: usize = 16 * 1024;

#[tokio::test]
async fn test_backpressure() -> Result<(), anyhow::Error> {
    let addr = addr();
    let (written_tx, mut written) = mpsc::unbounded_channel::<(usize, usize)>();
    tokio::spawn(Server::run(addr, written_tx));
    while TcpStream::connect(addr).is_err() {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let config = Arc::new(client::Config {
        window_size: CLIENT_WINDOW,
        ..Default::default()
    });
    let key = Arc::new(PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap());
    let mut session = client::connect(config, addr, Client).await?;
    assert!(
        session
            .authenticate_publickey(
                "user",
                PrivateKeyWithHashAlg::new(key, session.best_supported_rsa_hash().await?.flatten()),
            )
            .await?
            .success()
    );

    // Channel 0: the server floods it; the client does not read yet.
    let mut stalled = session.channel_open_session().await?;
    let mut flowing = session.channel_open_session().await?;

    // The server can only write about one window ahead of the reader.
    let mut stalled_bytes = 0;
    while let Ok(Some((0, total))) = timeout(Duration::from_millis(300), written.recv()).await {
        stalled_bytes = total;
    }
    assert!(stalled_bytes >= CLIENT_WINDOW as usize / 2);
    assert!(stalled_bytes <= CLIENT_WINDOW as usize + CHUNK);

    // Channel 1 keeps delivering while channel 0 is stalled.
    let mut received = 0;
    while received < 4 * CLIENT_WINDOW as usize {
        match timeout(Duration::from_secs(5), flowing.wait()).await? {
            Some(ChannelMsg::Data { data }) => received += data.len(),
            other => panic!("unexpected message {other:?}"),
        }
    }

    // Consuming channel 0 re-opens its window and the writer continues.
    let mut drained = 0;
    while drained < stalled_bytes + CHUNK {
        match timeout(Duration::from_secs(5), stalled.wait()).await? {
            Some(ChannelMsg::Data { data }) => drained += data.len(),
            other => panic!("unexpected message {other:?}"),
        }
    }
    Ok(())
}

/// Find a unused local address to bind our server to
fn addr() -> SocketAddr {
    TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
}

#[derive(Clone)]
struct Server {
    written: mpsc::UnboundedSender<(usize, usize)>,
    channels: usize,
}

impl Server {
    async fn run(addr: SocketAddr, written: mpsc::UnboundedSender<(usize, usize)>) {
        let config = Arc::new(server::Config {
            keys: vec![PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap()],
            ..Default::default()
        });
        let mut server = Server {
            written,
            channels: 0,
        };
        server.run_on_address(config, addr).await.unwrap();
    }
}

impl russh::server::Server for Server {
    type Handler = Self;

    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self::Handler {
        self.clone()
    }
}

impl russh::server::Handler for Server {
    type Error = anyhow::Error;

    async fn auth_publickey(
        &mut self,
        _: &str,
        _: &ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        let index = self.channels;
        self.channels += 1;
        let written = self.written.clone();
        tokio::spawn(async move {
            let mut writer = channel.make_writer();
            let chunk = vec![b'x'; CHUNK];
            let mut total = 0;
            loop {
                if writer.write_all(&chunk).await.is_err() {
                    break;
                }
                total += CHUNK;
                let _ = written.send((index, total));
            }
        });
        Ok(true)
    }
}

struct Client;

impl russh::client::Handler for Client {
    type Error = anyhow::Error;

    async fn check_server_key(&mut self, _: &ssh_key::PublicKey) -> Result<bool, Self::Error> {
        Ok(true)
    }
}
